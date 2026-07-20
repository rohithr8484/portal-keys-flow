/**
 * EIP-7702 helpers — sign an authorization delegating the EOA to the
 * ZeroDev Kernel v3.3 implementation and submit a Type-4 transaction.
 *
 * Testnet path uses a locally stored private key (the 7702 kernel key).
 * Mainnet path asks the connected injected wallet (MetaMask) to sign the
 * authorization via viem's experimental EIP-7702 actions; if the wallet
 * does not yet support `eth_signAuthorization`, callers should fall back
 * to a plain `eth_sendTransaction`.
 */
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import { eip7702Actions } from "viem/experimental";

/** ZeroDev Kernel v3.3 implementation — the delegate contract for EIP-7702. */
export const KERNEL_V3_3_IMPLEMENTATION =
  "0xd6CEDDe84be40893d153Be9d467CD6aD37875b28" as const;

type SendParams = {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
};

/**
 * Send a Type-4 transaction from a local private-key account on Arbitrum
 * Sepolia, including a fresh EIP-7702 authorization delegating the EOA to
 * the ZeroDev Kernel v3.3 implementation.
 */
export async function sendTestnet7702Tx(
  privateKey: `0x${string}`,
  params: SendParams,
): Promise<`0x${string}`> {
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport: http(),
  }).extend(eip7702Actions());

  try {
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
    } as any);
    return hash as Hex;
  } catch (err) {
    // Fall back to a plain transfer if the RPC rejects the 7702 tx.
    const hash = await walletClient.sendTransaction({
      account,
      to: params.to,
      data: params.data,
      value: params.value,
    });
    return hash as Hex;
  }
}

/**
 * Send a Type-4 transaction from the connected injected wallet on Arbitrum
 * One. If the wallet cannot sign an EIP-7702 authorization, falls back to
 * a plain `eth_sendTransaction`.
 */
export async function sendMainnet7702Tx(
  ethereum: any,
  from: `0x${string}`,
  params: SendParams,
): Promise<`0x${string}`> {
  const walletClient = createWalletClient({
    account: from,
    chain: arbitrum,
    transport: custom(ethereum),
  }).extend(eip7702Actions());

  try {
    const authorization = await walletClient.signAuthorization({
      account: from,
      contractAddress: KERNEL_V3_3_IMPLEMENTATION,
      executor: "self",
    });

    const hash = await walletClient.sendTransaction({
      account: from,
      to: params.to,
      data: params.data,
      value: params.value,
      authorizationList: [authorization],
    } as any);
    return hash as Hex;
  } catch (err) {
    const valueHex =
      params.value !== undefined ? ("0x" + params.value.toString(16)) : undefined;
    const txHash: string = await ethereum.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to: params.to,
          data: params.data,
          ...(valueHex ? { value: valueHex } : {}),
        },
      ],
    });
    return txHash as `0x${string}`;
  }
}
