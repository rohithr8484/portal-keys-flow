/**
 * Mainnet-only EIP-7702 + Particle Universal Account payment helper.
 *
 * viem's `signAuthorization` action does not support JSON-RPC accounts
 * (MetaMask), so we use a persistent local burner account for the 7702
 * authorization + userOp signing. MetaMask is only used to top the burner
 * up with the required ETH (amount + a small gas buffer) if its balance is
 * insufficient on Arbitrum One.
 *
 * Flow:
 *   1. Load/create a persistent burner private key in localStorage.
 *   2. Ensure the burner has enough ETH on Arbitrum One — otherwise ask
 *      MetaMask to send the shortfall to the burner.
 *   3. Build a UA (useEIP7702: true) with the burner as the owner.
 *   4. If burner is not yet delegated on Arbitrum One, send a self-executed
 *      Type-4 authorization tx via viem.
 *   5. Build native ETH transfer via `ua.createTransferTransaction`.
 *   6. Sign per-userOp EIP-7702 authorizations with the local wallet
 *      client (one signature per unique nonce).
 *   7. Sign the tx rootHash with the burner account and submit via
 *      `ua.sendTransaction(tx, rootSig, authorizations)`.
 */
import { ethers } from "ethers";
import { PARTICLE_APP_ID, PARTICLE_CLIENT_KEY, PARTICLE_PROJECT_ID } from "@/lib/particle-config";

const ARB_ONE_HEX = "0xa4b1";
const ARB_ONE_RPC = "https://arb1.arbitrum.io/rpc";
const ARB_EXPLORER = "https://arbiscan.io";
const BURNER_STORAGE_KEY = "paygrid_mainnet_7702_burner_pk";
// Small buffer to cover the self-executed 7702 authorization tx + the tiny
// gas the UA sponsored flow may still consume from the burner.
const GAS_BUFFER_WEI = 200_000_000_000_000n; // 0.0002 ETH

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

async function loadOrCreateBurnerPk(
  generatePrivateKey: () => `0x${string}`,
): Promise<`0x${string}`> {
  const existing = window.localStorage.getItem(BURNER_STORAGE_KEY);
  if (existing && /^0x[0-9a-fA-F]{64}$/.test(existing)) return existing as `0x${string}`;
  const pk = generatePrivateKey();
  window.localStorage.setItem(BURNER_STORAGE_KEY, pk);
  return pk;
}

export async function payMainnetPackageWith7702UA(
  args: Mainnet7702PayArgs,
): Promise<Mainnet7702PayResult> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask not detected");
  }

  // Ensure MetaMask is on Arbitrum One (needed for the top-up tx).
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

  const mmAccounts: string[] = await window.ethereum.request({ method: "eth_requestAccounts" });
  const mmOwner = ethers.getAddress(mmAccounts[0]) as `0x${string}`;

  const [
    { UniversalAccount, UNIVERSAL_ACCOUNT_VERSION, CHAIN_ID },
    viem,
    viemChains,
    viemAccounts,
    viemExp,
  ] = await Promise.all([
    import("@particle-network/universal-account-sdk"),
    import("viem"),
    import("viem/chains"),
    import("viem/accounts"),
    import("viem/experimental"),
  ]);

  // ---- Local burner account (needed because viem.signAuthorization does
  // not support JSON-RPC accounts). ----
  const burnerPk = await loadOrCreateBurnerPk(
    (viemAccounts as any).generatePrivateKey as () => `0x${string}`,
  );
  const burner = (viemAccounts as any).privateKeyToAccount(burnerPk);
  const burnerAddress = burner.address as `0x${string}`;

  const publicClient = viem.createPublicClient({
    chain: viemChains.arbitrum,
    transport: viem.http(ARB_ONE_RPC),
  });

  // ---- Ensure the burner has enough ETH ----
  const amountWei = viem.parseEther(args.amountEth as `${number}`);
  const needed = amountWei + GAS_BUFFER_WEI;
  const burnerBal = await publicClient.getBalance({ address: burnerAddress });
  if (burnerBal < needed) {
    const shortfall = needed - burnerBal;
    const topupHash: `0x${string}` = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: mmOwner,
          to: burnerAddress,
          value: `0x${shortfall.toString(16)}`,
        },
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: topupHash });
  }

  // ---- Local wallet client with EIP-7702 actions ----
  const walletClient: any = (viem.createWalletClient({
    account: burner,
    chain: viemChains.arbitrum,
    transport: viem.http(ARB_ONE_RPC),
  }) as any).extend((viemExp as any).eip7702Actions as any);

  // ---- UA with burner as owner ----
  const ua: any = new (UniversalAccount as any)({
    projectId: PARTICLE_PROJECT_ID,
    projectClientKey: PARTICLE_CLIENT_KEY,
    projectAppUuid: PARTICLE_APP_ID,
    smartAccountOptions: {
      useEIP7702: true,
      name: "UNIVERSAL",
      version: UNIVERSAL_ACCOUNT_VERSION,
      ownerAddress: burnerAddress,
    },
  });

  const targetChain = (CHAIN_ID as any).ARBITRUM_MAINNET_ONE;

  // ---- Step 1: ensure delegation on Arbitrum One ----
  const deployments = await ua.getEIP7702Deployments();
  const deployment = deployments.find((d: any) => d.chainId === targetChain);
  if (!deployment?.isDelegated) {
    const auths = await ua.getEIP7702Auth([targetChain]);
    const auth = auths[0];
    const signedAuth = await walletClient.signAuthorization({
      account: burner,
      contractAddress: auth.address,
      chainId: auth.chainId,
      executor: "self",
    });
    const delegationHash: `0x${string}` = await walletClient.sendTransaction({
      account: burner,
      to: "0x0000000000000000000000000000000000000000",
      authorizationList: [signedAuth],
    });
    await publicClient.waitForTransactionReceipt({ hash: delegationHash });
  }

  // ---- Step 2: build native ETH transfer through the UA ----
  const transaction = await ua.createTransferTransaction({
    token: {
      chainId: targetChain,
      address: "0x0000000000000000000000000000000000000000",
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
        const signed = await walletClient.signAuthorization({
          account: burner,
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

  // ---- Step 4: sign rootHash with the local burner and submit ----
  const rootSig = await burner.signMessage({
    message: { raw: transaction.rootHash as `0x${string}` },
  });

  const result = await ua.sendTransaction(transaction, rootSig, authorizations);
  const txId: string = result?.transactionId ?? result?.transactionHash ?? "";
  const txUrl = /^0x[0-9a-fA-F]{64}$/.test(txId)
    ? `${ARB_EXPLORER}/tx/${txId}`
    : `https://universalx.app/activity/details?id=${txId}`;
  return { txId, txUrl };
}
