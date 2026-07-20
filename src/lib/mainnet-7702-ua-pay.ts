/**
 * Mainnet-only EIP-7702 + Particle Universal Account payment helper.
 *
 * Used by a small subset of Tourist Packages so that the on-chain
 * transaction shows up on Arbiscan with the "EIP-7702" TRANSACTION ACTION
 * (Delegate + Transfer) instead of a plain EOA transfer.
 *
 * Flow (mirrors the Particle UA EIP-7702 reference example):
 *   1. Ensure the connected EOA is delegated to the UA implementation on
 *      the target chain (Arbitrum One). If not, send a Type-4 self-executed
 *      authorization tx via viem.
 *   2. Build a native ETH transfer through `ua.createTransferTransaction`.
 *   3. For every userOp with an unsigned `eip7702Auth`, produce an ECDSA
 *      signature over `hashAuthorization(auth)` — one signature per unique
 *      auth nonce.
 *   4. Sign the transaction rootHash with `personal_sign` and submit via
 *      `ua.sendTransaction(tx, rootSig, authorizations)`.
 */
import { ethers } from "ethers";
import { PARTICLE_APP_ID, PARTICLE_CLIENT_KEY, PARTICLE_PROJECT_ID } from "@/lib/particle-config";

const ARB_ONE_HEX = "0xa4b1";
const ARB_ONE_RPC = "https://arb1.arbitrum.io/rpc";
const ARB_EXPLORER = "https://arbiscan.io";

export type Mainnet7702PayArgs = {
  recipient: string;
  /** Human-readable ETH amount, e.g. "0.00096". */
  amountEth: string;
  label?: string;
};

export type Mainnet7702PayResult = {
  txId: string;
  txUrl: string;
};

function toSerializedSignature(r: `0x${string}`, s: `0x${string}`, yParity: 0 | 1): `0x${string}` {
  const rHex = r.slice(2).padStart(64, "0");
  const sHex = s.slice(2).padStart(64, "0");
  const v = (27 + yParity).toString(16).padStart(2, "0");
  return `0x${rHex}${sHex}${v}` as `0x${string}`;
}

export async function payMainnetPackageWith7702UA(
  args: Mainnet7702PayArgs,
): Promise<Mainnet7702PayResult> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask not detected");
  }

  // Ensure the wallet is on Arbitrum One.
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ARB_ONE_HEX }],
    });
  } catch (err: any) {
    if (err?.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: ARB_ONE_HEX,
            chainName: "Arbitrum One",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [ARB_ONE_RPC],
            blockExplorerUrls: [ARB_EXPLORER],
          },
        ],
      });
    } else {
      throw err;
    }
  }

  const accounts: string[] = await window.ethereum.request({ method: "eth_requestAccounts" });
  const owner = ethers.getAddress(accounts[0]) as `0x${string}`;

  const [{ UniversalAccount, UNIVERSAL_ACCOUNT_VERSION, CHAIN_ID }, viem, viemChains, viemExp] =
    await Promise.all([
      import("@particle-network/universal-account-sdk"),
      import("viem"),
      import("viem/chains"),
      import("viem/experimental"),
    ]);

  const walletClient: any = (viem.createWalletClient({
    account: owner,
    chain: viemChains.arbitrum,
    transport: viem.custom(window.ethereum),
  }) as any).extend((viemExp as any).eip7702Actions as any);

  const ua: any = new (UniversalAccount as any)({
    projectId: PARTICLE_PROJECT_ID,
    projectClientKey: PARTICLE_CLIENT_KEY,
    projectAppUuid: PARTICLE_APP_ID,
    smartAccountOptions: {
      useEIP7702: true,
      name: "UNIVERSAL",
      version: UNIVERSAL_ACCOUNT_VERSION,
      ownerAddress: owner,
    },
  });

  const targetChain = (CHAIN_ID as any).ARBITRUM_MAINNET_ONE;

  // ---- Step 1: ensure delegation on Arbitrum One ----
  const deployments = await ua.getEIP7702Deployments();
  const deployment = deployments.find((d: any) => d.chainId === targetChain);
  if (!deployment?.isDelegated) {
    const auths = await ua.getEIP7702Auth([targetChain]);
    const auth = auths[0];
    // Self-executed 7702 authorization tx — viem handles nonce+1 semantics
    // when executor is "self".
    const signedAuth = await walletClient.signAuthorization({
      account: owner,
      contractAddress: auth.address,
      chainId: auth.chainId,
      executor: "self",
    });
    const delegationHash: `0x${string}` = await walletClient.sendTransaction({
      account: owner,
      to: "0x0000000000000000000000000000000000000000",
      authorizationList: [signedAuth],
    });
    // Wait for the delegation tx before building the transfer.
    const publicClient = viem.createPublicClient({
      chain: viemChains.arbitrum,
      transport: viem.http(ARB_ONE_RPC),
    });
    await publicClient.waitForTransactionReceipt({ hash: delegationHash });
  }

  // ---- Step 2: build native ETH transfer through the UA ----
  const transaction = await ua.createTransferTransaction({
    token: {
      chainId: targetChain,
      address: "0x0000000000000000000000000000000000000000", // native ETH
    },
    amount: args.amountEth,
    receiver: ethers.getAddress(args.recipient),
  });

  // ---- Step 3: sign per-userOp EIP-7702 authorizations ----
  const authorizations: { userOpHash: string; signature: string }[] = [];
  const sigByNonce = new Map<number, string>();
  for (const userOp of transaction.userOps ?? []) {
    if (userOp.eip7702Auth && !userOp.eip7702Delegated) {
      const nonce: number = userOp.eip7702Auth.nonce;
      let sig = sigByNonce.get(nonce);
      if (!sig) {
        // Sign the same authorization tuple {chainId, contract, nonce}
        // that hashAuthorization would produce — viem's signAuthorization
        // signs the identical hash, so the resulting signature validates
        // when re-submitted through the UA sponsored userOp.
        const signed = await walletClient.signAuthorization({
          account: owner,
          contractAddress: userOp.eip7702Auth.address,
          chainId: userOp.eip7702Auth.chainId,
          nonce,
        });
        sig = toSerializedSignature(
          signed.r as `0x${string}`,
          signed.s as `0x${string}`,
          (signed.yParity ?? (typeof signed.v === "bigint" ? Number(signed.v) - 27 : 0)) as 0 | 1,
        );
        sigByNonce.set(nonce, sig);
      }
      authorizations.push({ userOpHash: userOp.userOpHash, signature: sig });
    }
  }

  // ---- Step 4: sign rootHash and submit ----
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const rootSig = await signer.signMessage(ethers.getBytes(transaction.rootHash));

  const result = await ua.sendTransaction(transaction, rootSig, authorizations);
  const txId: string = result?.transactionId ?? result?.transactionHash ?? "";
  const txUrl = /^0x[0-9a-fA-F]{64}$/.test(txId)
    ? `${ARB_EXPLORER}/tx/${txId}`
    : `https://universalx.app/activity/details?id=${txId}`;
  return { txId, txUrl };
}
