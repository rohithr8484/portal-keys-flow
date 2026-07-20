/**
 * EIP-7702 helpers.
 *
 * Every transfer we submit for our own EOAs (testnet local 7702 key, mainnet
 * MetaMask signer) is wrapped in a type-4 transaction whose `authorizationList`
 * delegates the EOA to the ZeroDev Kernel v3.3 implementation. This is what
 * makes Arbiscan render the "EIP-7702: 0x… Delegate to 0x…" chip on the tx.
 *
 * The authorization is idempotent — signing it again on an already-delegated
 * account still succeeds. We include it on every tx so an account that hasn't
 * been delegated yet is upgraded on its next transfer.
 */
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arbitrum, arbitrumSepolia } from "viem/chains";

/** ZeroDev Kernel v3.3 implementation — the delegate contract for EIP-7702. */
export const KERNEL_V3_3_IMPLEMENTATION =
  "0xd6CEDDe84be40893d153Be9d467CD6aD37875b28" as const;

type SendParams = {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
};

/**
 * Send a type-4 transaction from a local private-key account on Arbitrum
 * Sepolia, including a fresh EIP-7702 authorization delegating the EOA to the
 * Kernel v3.3 implementation. Returns the transaction hash.
 */
export async function sendTestnet7702Tx(
  privateKey: `0x${string}`,
  params: SendParams,
): Promise<`0x${string}`> {
  const account: PrivateKeyAccount = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport: http("https://sepolia-rollup.arbitrum.io/rpc"),
  });
  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http("https://sepolia-rollup.arbitrum.io/rpc"),
  });

  // Sign the authorization for this transaction. When the signer is the same
  // account paying for the tx, viem auto-bumps the authorization nonce by 1.
  const authorization = await walletClient.signAuthorization({
    account,
    contractAddress: KERNEL_V3_3_IMPLEMENTATION,
    executor: "self",
  });

  const hash = await walletClient.sendTransaction({
    account,
    to: params.to,
    data: params.data,
    value: params.value,
    authorizationList: [authorization],
    // viem infers type "eip7702" from the presence of authorizationList.
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash as Hex;
}

/**
 * Send a type-4 transaction from the connected MetaMask (or compatible)
 * injected wallet on Arbitrum One. Attempts to sign a 7702 authorization
 * through the wallet; if the wallet does not implement `eth_signAuthorization`
 * yet, falls back to a plain `eth_sendTransaction` so the payment still goes
 * through.
 */
export async function sendInjected7702Tx(
  ethereum: any,
  chain: any,
  from: `0x${string}`,
  params: SendParams,
): Promise<`0x${string}`> {
  const publicClient = createPublicClient({ chain, transport: custom(ethereum) });

  try {
    const walletClient = createWalletClient({ chain, transport: custom(ethereum) });

    const authorization = await walletClient.signAuthorization({
      account: from,
      contractAddress: KERNEL_V3_3_IMPLEMENTATION,
      executor: "self",
    });

    const hash = await walletClient.sendTransaction({
      account: from,
      chain,
      to: params.to,
      data: params.data,
      value: params.value,
      authorizationList: [authorization],
    });


    await publicClient.waitForTransactionReceipt({ hash });
    return hash as Hex;
  } catch (err: any) {
    const msg = String(err?.shortMessage || err?.message || "");
    const unsupported =
      /not support|unsupported|unknown method|method not/i.test(msg) ||
      err?.code === 4200 ||
      err?.code === -32601 ||
      err?.code === -32004;
    if (!unsupported) throw err;

    // Fallback: plain legacy transaction, no 7702 delegation.
    const params0: any = { from, to: params.to };
    if (params.data) params0.data = params.data;
    if (params.value !== undefined) params0.value = "0x" + params.value.toString(16);
    const hash: `0x${string}` = await ethereum.request({
      method: "eth_sendTransaction",
      params: [params0],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }
}

/** Mainnet convenience wrapper (Arbitrum One). */
export async function sendMainnet7702Tx(
  ethereum: any,
  from: `0x${string}`,
  params: SendParams,
): Promise<`0x${string}`> {
  return sendInjected7702Tx(ethereum, arbitrum, from, params);
}

