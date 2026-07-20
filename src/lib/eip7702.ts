/**
 * EIP-7702 helpers — sign an authorization delegating the EOA to the
 * ZeroDev Kernel v3.3 implementation and submit a Type-4 transaction.
 */
import {
  createWalletClient,
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

export async function sendTestnet7702Tx(
  privateKey: `0x${string}`,
  params: SendParams,
): Promise<`0x${string}`> {
  const account = privateKeyToAccount(privateKey);
  const walletClient: any = (createWalletClient({
    account,
    chain: arbitrumSepolia,
    transport: http(),
  }) as any).extend(eip7702Actions() as any);

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
    });
    return hash as Hex;
  } catch {
    const hash = await walletClient.sendTransaction({
      account,
      to: params.to,
      data: params.data,
      value: params.value,
    });
    return hash as Hex;
  }
}

export async function sendMainnet7702Tx(
  ethereum: any,
  from: `0x${string}`,
  params: SendParams,
): Promise<`0x${string}`> {
  const walletClient: any = (createWalletClient({
    account: from,
    chain: arbitrum,
    transport: custom(ethereum),
  }) as any).extend(eip7702Actions() as any);

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
    });
    return hash as Hex;
  } catch {
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
