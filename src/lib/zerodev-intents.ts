// ZeroDev Intent helpers — ported from
// https://github.com/zerodevapp/zerodev-examples/tree/main/intent
//
// These flows run against MAINNET (Arbitrum → Base) because CAB requires real
// USDC deposits. We reuse the user's connected MetaMask EOA as the signer.

import { arbitrum, base } from "viem/chains";
import type { Hex } from "viem";

const ZERODEV_PROJECT_ID = "263a14d6-19fe-4e98-8ba4-02b793c1aa0a";
// Arbitrum mainnet ZeroDev RPC (uses same project id, chain 42161).
export const ZERODEV_RPC_ARB =
  `https://rpc.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}/chain/42161`;

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const TIMEOUT = 100_000;

type LogFn = (msg: string) => void;

async function loadDeps() {
  const [
    intent,
    { createKernelAccount, createZeroDevPaymasterClient },
    { KERNEL_V3_2, getEntryPoint },
    { toMultiChainECDSAValidator },
    viem,
  ] = await Promise.all([
    import("@zerodev/intent"),
    import("@zerodev/sdk"),
    import("@zerodev/sdk/constants"),
    import("@zerodev/multi-chain-ecdsa-validator"),
    import("viem"),
  ]);
  return {
    intent,
    createKernelAccount,
    createZeroDevPaymasterClient,
    KERNEL_V3_2,
    getEntryPoint,
    toMultiChainECDSAValidator,
    viem,
  };
}

function getEthereum() {
  const eth = (typeof window !== "undefined" && (window as any).ethereum) || null;
  if (!eth) throw new Error("MetaMask not detected");
  return eth;
}

// Build a viem JSON-RPC account from window.ethereum.
async function getEoaAccount() {
  const eth = getEthereum();
  const { custom, createWalletClient } = await import("viem");
  const wallet = createWalletClient({ transport: custom(eth) });
  const [addr] = await wallet.getAddresses();
  if (!addr) throw new Error("No EOA address");
  return { address: addr as Hex, wallet };
}

async function buildIntentClient(log: LogFn, opts: { sponsored?: boolean } = {}) {
  log("Loading ZeroDev intent SDK…");
  const deps = await loadDeps();
  const { intent, viem, createKernelAccount, getEntryPoint, KERNEL_V3_2 } = deps;
  const { createPublicClient, http, custom, createWalletClient } = viem;

  const eth = getEthereum();
  const wallet = createWalletClient({
    chain: arbitrum,
    transport: custom(eth),
  });
  const [addr] = await wallet.getAddresses();
  if (!addr) throw new Error("No EOA");

  const publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(),
  });

  log("Creating multi-chain ECDSA validator…");
  const signerAcc: any = { ...(wallet.account as any), address: addr };
  const ecdsaValidator = await deps.toMultiChainECDSAValidator(
    publicClient as any,
    {
      signer: signerAcc,
      kernelVersion: KERNEL_V3_2,
      entryPoint: getEntryPoint("0.7"),
    }
  );

  log("Creating Kernel account with intent executor…");
  const kernelAccount = await createKernelAccount(publicClient as any, {
    plugins: { sudo: ecdsaValidator },
    kernelVersion: KERNEL_V3_2,
    entryPoint: getEntryPoint("0.7"),
    initConfig: [intent.installIntentExecutor(intent.INTENT_V0_4)],
  });

  const intentClient = intent.createIntentClient({
    account: kernelAccount,
    chain: arbitrum,
    bundlerTransport: http(ZERODEV_RPC_ARB, { timeout: TIMEOUT }),
    version: intent.INTENT_V0_4,
    ...(opts.sponsored ? { projectId: ZERODEV_PROJECT_ID } : {}),
  } as any);

  return { intentClient, kernelAccount, eoa: addr };
}

async function buildTransferCall(toAddr: Hex) {
  const { encodeFunctionData, erc20Abi, parseUnits } = await import("viem");
  return {
    to: USDC_BASE as Hex,
    value: BigInt(0),
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [toAddr, parseUnits("0.1", 6)],
    }),
  };
}

async function sendIntent(
  gasToken: undefined | "NATIVE" | "SPONSORED",
  log: LogFn
) {
  const sponsored = gasToken === "SPONSORED";
  const { intentClient, eoa } = await buildIntentClient(log, { sponsored });
  log(`Smart account: ${intentClient.account.address}`);
  log("Fetching chain-abstracted balance (CAB)…");
  const { parseUnits, formatUnits } = await import("viem");
  const cab = await intentClient.getCAB({
    networks: [arbitrum.id, base.id],
    tokenTickers: ["USDC"],
  });
  const have = BigInt(cab.tokens?.[0]?.amount ?? 0);
  log(`CAB USDC: ${formatUnits(have, 6)}`);
  if (have < parseUnits("0.1", 6)) {
    throw new Error(
      `Insufficient USDC across chains. Deposit ≥ 0.1 USDC to ${intentClient.account.address} on Arbitrum/Base.`
    );
  }

  log("Sending UserIntent…");
  const call = await buildTransferCall(eoa);
  const result = await intentClient.sendUserIntent({
    calls: [call],
    outputTokens: [
      { chainId: base.id, address: USDC_BASE, amount: parseUnits("0.1", 6) },
    ],
    ...(gasToken ? { gasToken } : {}),
  } as any);
  log(`intentId: ${result.outputUiHash.uiHash}`);

  await Promise.all(
    result.inputsUiHash.map(async (data: any) => {
      const r = await intentClient.waitForUserIntentOpenReceipt({
        uiHash: data.uiHash,
      });
      log(`opened on chain ${r?.openChainId} tx ${r?.receipt.transactionHash}`);
    })
  );
  const receipt = await intentClient.waitForUserIntentExecutionReceipt({
    uiHash: result.outputUiHash.uiHash,
  });
  log(
    `executed on ${receipt?.executionChainId} tx ${receipt?.receipt.transactionHash}`
  );
  return receipt;
}

export const sendIntentDefault = (log: LogFn) => sendIntent(undefined, log);
export const sendIntentNative = (log: LogFn) => sendIntent("NATIVE", log);
export const sendIntentSponsored = (log: LogFn) => sendIntent("SPONSORED", log);

export async function enableIntent(log: LogFn) {
  log("Loading deps for enableIntent…");
  const deps = await loadDeps();
  const { intent, viem, createKernelAccount, createZeroDevPaymasterClient } = deps;
  const { createPublicClient, http, custom, createWalletClient } = viem;
  const { KERNEL_V3_0, getEntryPoint } = deps;

  const eth = getEthereum();
  const wallet = createWalletClient({ chain: arbitrum, transport: custom(eth) });
  const [addr] = await wallet.getAddresses();
  if (!addr) throw new Error("No EOA");
  const publicClient = createPublicClient({ chain: arbitrum, transport: http() });

  const ecdsaValidator = await deps.toMultiChainECDSAValidator(
    publicClient as any,
    {
      signer: { ...wallet.account, address: addr } as any,
      kernelVersion: KERNEL_V3_0 as any,
      entryPoint: getEntryPoint("0.7"),
    }
  );
  const kernelAccount = await createKernelAccount(publicClient as any, {
    plugins: { sudo: ecdsaValidator },
    kernelVersion: KERNEL_V3_0 as any,
    entryPoint: getEntryPoint("0.7"),
  });
  log(`V3.0 account: ${kernelAccount.address}`);

  const intentClient = intent.createIntentClient({
    account: kernelAccount,
    chain: arbitrum,
    bundlerTransport: http(ZERODEV_RPC_ARB, { timeout: TIMEOUT }),
    paymaster: createZeroDevPaymasterClient({
      chain: arbitrum,
      transport: http(ZERODEV_RPC_ARB, { timeout: TIMEOUT }),
    }),
    client: publicClient,
    version: intent.INTENT_V0_4,
  } as any);

  log("Enabling intent (upgrading to V3.2)…");
  const enableHash = await intentClient.enableIntent();
  log(`enable hash: ${enableHash}`);
  const r = await intentClient.waitForUserOperationReceipt({ hash: enableHash });
  log(`upgrade tx: ${r.receipt.transactionHash}`);
}

export async function migrateToIntentExecutor(log: LogFn) {
  log("Loading deps for migration…");
  const deps = await loadDeps();
  const { intent, viem, createKernelAccount, createZeroDevPaymasterClient } = deps;
  const { createPublicClient, http, custom, createWalletClient, zeroAddress } =
    viem;
  const { KERNEL_V3_2, getEntryPoint } = deps;

  const eth = getEthereum();
  const wallet = createWalletClient({ chain: arbitrum, transport: custom(eth) });
  const [addr] = await wallet.getAddresses();
  if (!addr) throw new Error("No EOA");
  const publicClient = createPublicClient({ chain: arbitrum, transport: http() });

  const ecdsaValidator = await deps.toMultiChainECDSAValidator(
    publicClient as any,
    {
      signer: { ...wallet.account, address: addr } as any,
      kernelVersion: KERNEL_V3_2,
      entryPoint: getEntryPoint("0.7"),
    }
  );

  const kernelAccount = await createKernelAccount(publicClient as any, {
    plugins: { sudo: ecdsaValidator },
    kernelVersion: KERNEL_V3_2,
    entryPoint: getEntryPoint("0.7"),
    pluginMigrations: [intent.getIntentExecutorPluginData(intent.INTENT_V0_4)],
  });
  const paymasterClient = createZeroDevPaymasterClient({
    chain: arbitrum,
    transport: http(ZERODEV_RPC_ARB, { timeout: TIMEOUT }),
  });
  const intentClient = intent.createIntentClient({
    account: kernelAccount,
    chain: arbitrum,
    bundlerTransport: http(ZERODEV_RPC_ARB, { timeout: TIMEOUT }),
    paymaster: paymasterClient,
    client: publicClient,
    version: intent.INTENT_V0_4,
  } as any);

  log("Sending no-op to trigger plugin migration…");
  const hash = await intentClient.sendUserOperation({
    callData: await kernelAccount.encodeCalls([
      { to: zeroAddress, value: BigInt(0), data: "0x" },
    ]),
  });
  const r = await intentClient.waitForUserOperationReceipt({ hash });
  log(`migrated · tx ${r.receipt.transactionHash}`);
}

export async function estimateIntentFee(log: LogFn) {
  const { intentClient } = await buildIntentClient(log);
  const { parseUnits, formatUnits } = await import("viem");
  log("Estimating fee for 0.1 USDC → Base…");
  const call = await buildTransferCall(intentClient.account.address);
  const fee = await intentClient.estimateUserIntentFees({
    calls: [call],
    outputTokens: [
      { chainId: base.id, address: USDC_BASE, amount: parseUnits("0.1", 6) },
    ],
  } as any);
  log(`Fee estimate: ${JSON.stringify(fee, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v
  )}`);
}
