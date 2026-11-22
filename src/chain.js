import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";

const CHAIN_ID = "0xf22f";
const RPC = "https://studio.genlayer.com/api";
const CHAIN = {
  chainId: CHAIN_ID,
  chainName: "GenLayer Studionet",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: [RPC],
  blockExplorerUrls: ["https://explorer-studio.genlayer.com"],
};

export const client = createClient({ chain: studionet, timeout: 12_000 });

export function inspectReceipt(tx) {
  const consensus = tx?.result_name ?? null;
  const rows = [tx?.consensus_data?.leader_receipt ?? []].flat();
  const leader = rows.findLast((receipt) => receipt?.mode === "leader") ?? rows[0];
  const execution = leader?.execution_result ?? tx?.txExecutionResultName ?? null;
  return {
    status: tx?.statusName ?? "PENDING",
    consensus,
    execution,
    detail: leader?.genvm_result?.message ?? leader?.genvm_result?.data ?? null,
    success: ["SUCCESS", "FINISHED_WITH_RETURN"].includes(execution) && ["MAJORITY_AGREE", "AGREE"].includes(consensus),
  };
}

export async function read(address, functionName, args = []) {
  const data = await client.readContract({
    address, functionName, args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  return data ? JSON.parse(data) : null;
}

export function guestWallet() {
  const account = createAccount();
  return { address: account.address.toLowerCase(), account, kind: "Temporary wallet" };
}

export function walletProvider(kind, registry) {
  if (kind === "OKX") {
    return registry.get("com.okex.wallet")
      ?? window.okxwallet?.ethereum
      ?? window.okxwallet
      ?? window.ethereum?.providers?.find((p) => p.isOkxWallet || p.isOKXWallet);
  }
  const found = registry.get("io.metamask");
  if (found) return found;
  const list = window.ethereum?.providers ?? [window.ethereum];
  const matches = list.filter((p) => p?.isMetaMask && !p.isOkxWallet && !p.isOKXWallet && p !== window.okxwallet);
  return matches[0];
}

export async function ensureChain(provider) {
  if (await provider.request({ method: "eth_chainId" }) === CHAIN_ID) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID }] });
  } catch (error) {
    if (Number(error.code ?? error.data?.originalError?.code) !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [CHAIN] });
    if (await provider.request({ method: "eth_chainId" }) !== CHAIN_ID) {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID }] });
    }
  }
  if (await provider.request({ method: "eth_chainId" }) !== CHAIN_ID) throw Error("Select Stable Studionet in your wallet.");
}

export async function connect(kind, registry) {
  const provider = walletProvider(kind, registry);
  if (!provider?.request) throw Error(kind + " was not found in this browser.");
  const [address] = await provider.request({ method: "eth_requestAccounts" });
  if (!address) throw Error("The wallet did not provide an account.");
  await ensureChain(provider);
  return { address: address.toLowerCase(), provider, kind };
}

export async function write(address, signer, method, args) {
  if (signer.provider) {
    await ensureChain(signer.provider);
    const [active] = await signer.provider.request({ method: "eth_accounts" });
    if (active?.toLowerCase() !== signer.address) throw Error("The wallet account changed. Reconnect and retry.");
  }
  const sender = createClient({
    chain: studionet,
    account: signer.account ?? signer.address,
    ...(signer.provider ? { provider: signer.provider } : {}),
  });
  return sender.writeContract({ address, functionName: method, args, value: 0n, leaderOnly: false });
}
