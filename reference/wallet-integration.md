# Wallet Connection Patterns for ChainGPT NFT Minting

This guide covers wallet integration for dApps that use the ChainGPT NFT Generator API.
The backend generates images and prepares mint data; the frontend connects a wallet and
submits the on-chain transaction.

---

## Table of Contents

1. [MetaMask Integration](#1-metamask-integration)
2. [WalletConnect v2](#2-walletconnect-v2)
3. [ethers.js v6 Patterns](#3-ethersjs-v6-patterns)
4. [wagmi + viem Patterns](#4-wagmi--viem-patterns)
5. [Complete NFT Minting Flow](#5-complete-nft-minting-flow)
6. [Chain Switching](#6-chain-switching)
7. [Error Handling](#7-error-handling)
8. [Security Best Practices](#8-security-best-practices)

---

## 1. MetaMask Integration

### Detecting the Provider

```typescript
function getMetaMaskProvider(): any | null {
  if (typeof window === "undefined") return null;

  // EIP-6963: Multi-provider discovery (modern approach)
  // Falls back to window.ethereum for legacy support
  if (window.ethereum?.isMetaMask) {
    return window.ethereum;
  }

  // Handle case where multiple wallets inject window.ethereum
  if (window.ethereum?.providers) {
    return window.ethereum.providers.find((p: any) => p.isMetaMask) ?? null;
  }

  return null;
}
```

### Requesting Accounts

```typescript
async function connectMetaMask(): Promise<string> {
  const provider = getMetaMaskProvider();
  if (!provider) {
    throw new Error(
      "MetaMask not detected. Install it from https://metamask.io"
    );
  }

  const accounts: string[] = await provider.request({
    method: "eth_requestAccounts",
  });

  if (accounts.length === 0) {
    throw new Error("No accounts returned from MetaMask");
  }

  return accounts[0]; // Checksummed address
}
```

### Switching Chains

```typescript
interface ChainConfig {
  chainId: string; // Hex, e.g. "0x38" for BSC
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

async function switchChain(
  provider: any,
  chainId: number
): Promise<void> {
  const hexChainId = "0x" + chainId.toString(16);

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }],
    });
  } catch (error: any) {
    // 4902 = chain not added to wallet yet
    if (error.code === 4902) {
      const config = CHAIN_CONFIGS[chainId];
      if (!config) throw new Error(`No config for chain ${chainId}`);

      await provider.request({
        method: "wallet_addEthereumChain",
        params: [config],
      });
    } else {
      throw error;
    }
  }
}
```

### Common Chain Configurations

```typescript
const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  56: {
    chainId: "0x38",
    chainName: "BNB Smart Chain",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: ["https://bsc-dataseed.binance.org"],
    blockExplorerUrls: ["https://bscscan.com"],
  },
  137: {
    chainId: "0x89",
    chainName: "Polygon",
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    rpcUrls: ["https://polygon-rpc.com"],
    blockExplorerUrls: ["https://polygonscan.com"],
  },
  42161: {
    chainId: "0xa4b1",
    chainName: "Arbitrum One",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
    blockExplorerUrls: ["https://arbiscan.io"],
  },
  43114: {
    chainId: "0xa86a",
    chainName: "Avalanche C-Chain",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    rpcUrls: ["https://api.avax.network/ext/bc/C/rpc"],
    blockExplorerUrls: ["https://snowtrace.io"],
  },
  8453: {
    chainId: "0x2105",
    chainName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://basescan.org"],
  },
};
```

---

## 2. WalletConnect v2

### Installation

```bash
npm install @web3modal/wagmi wagmi viem @tanstack/react-query
```

### Web3Modal Setup

```typescript
// lib/web3modal.ts
import { createWeb3Modal } from "@web3modal/wagmi/react";
import { defaultWagmiConfig } from "@web3modal/wagmi/react/config";
import {
  mainnet,
  bsc,
  polygon,
  arbitrum,
  avalanche,
  base,
  linea,
  scroll,
  mantle,
} from "wagmi/chains";

// 1. Get a project ID from https://cloud.walletconnect.com
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!;

const metadata = {
  name: "My NFT Minter",
  description: "Mint AI-generated NFTs via ChainGPT",
  url: "https://example.com",
  icons: ["https://example.com/icon.png"],
};

// 2. Configure chains that ChainGPT NFT supports
const chains = [
  mainnet,
  bsc,
  polygon,
  arbitrum,
  avalanche,
  base,
  linea,
  scroll,
  mantle,
] as const;

export const wagmiConfig = defaultWagmiConfig({
  chains,
  projectId,
  metadata,
});

// 3. Create the modal
createWeb3Modal({
  wagmiConfig,
  projectId,
});
```

### React Provider Setup

```tsx
// app/providers.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/web3modal";

const queryClient = new QueryClient();

export function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

### Connect Button

```tsx
import { useWeb3Modal } from "@web3modal/wagmi/react";

export function ConnectButton() {
  const { open } = useWeb3Modal();
  return <button onClick={() => open()}>Connect Wallet</button>;
}
```

---

## 3. ethers.js v6 Patterns

### Installation

```bash
npm install ethers@6
```

### Creating a BrowserProvider from MetaMask

```typescript
import { BrowserProvider, Contract, parseEther } from "ethers";
import type { JsonRpcSigner } from "ethers";

async function getSignerFromMetaMask(): Promise<JsonRpcSigner> {
  if (!window.ethereum) {
    throw new Error("No wallet detected");
  }

  const provider = new BrowserProvider(window.ethereum);
  // This triggers the MetaMask connection popup if not already connected
  const signer = await provider.getSigner();
  return signer;
}
```

### Interacting with the Mint Contract

```typescript
import { BrowserProvider, Contract } from "ethers";

interface MintResponse {
  abi: any[];
  contractAddress: string;
  mintData: string; // Encoded function call data
  value?: string;   // Native token value to send (wei)
}

async function mintWithEthers(mintResponse: MintResponse): Promise<string> {
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  const contract = new Contract(
    mintResponse.contractAddress,
    mintResponse.abi,
    signer
  );

  // Option A: If the API returns encoded calldata, send a raw transaction
  const tx = await signer.sendTransaction({
    to: mintResponse.contractAddress,
    data: mintResponse.mintData,
    value: mintResponse.value ?? "0",
  });

  console.log("Transaction hash:", tx.hash);

  // Wait for confirmation
  const receipt = await tx.wait(1); // 1 confirmation
  if (!receipt || receipt.status === 0) {
    throw new Error("Transaction reverted");
  }

  console.log("Confirmed in block:", receipt.blockNumber);
  return tx.hash;
}
```

### Checking Balance Before Mint

```typescript
import { BrowserProvider, formatEther } from "ethers";

async function checkBalance(minRequired: bigint): Promise<void> {
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const balance = await provider.getBalance(signer.address);

  if (balance < minRequired) {
    const have = formatEther(balance);
    const need = formatEther(minRequired);
    throw new Error(
      `Insufficient balance: have ${have}, need at least ${need}`
    );
  }
}
```

---

## 4. wagmi + viem Patterns

### Installation

```bash
npm install wagmi viem @tanstack/react-query
```

### Hook-Based Wallet Connection

```tsx
import { useAccount, useConnect, useDisconnect, useChainId } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";

export function WalletManager() {
  const { address, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();

  if (isConnected) {
    return (
      <div>
        <p>
          Connected: {address} (Chain {chainId})
        </p>
        <button onClick={() => disconnect()}>Disconnect</button>
      </div>
    );
  }

  return (
    <div>
      <button
        disabled={isPending}
        onClick={() => connect({ connector: injected() })}
      >
        {isPending ? "Connecting..." : "Connect MetaMask"}
      </button>
      <button
        disabled={isPending}
        onClick={() =>
          connect({
            connector: walletConnect({
              projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
            }),
          })
        }
      >
        WalletConnect
      </button>
    </div>
  );
}
```

### Contract Write for Minting

```tsx
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import { type Abi, type Address } from "viem";

interface MintParams {
  abi: Abi;
  contractAddress: Address;
  functionName: string;
  args: unknown[];
  value?: bigint;
}

export function useMintNft() {
  const {
    writeContract,
    data: txHash,
    isPending: isSigning,
    error: writeError,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  function mint(params: MintParams) {
    writeContract({
      address: params.contractAddress,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
      value: params.value,
    });
  }

  return {
    mint,
    txHash,
    isSigning,
    isConfirming,
    isSuccess,
    error: writeError ?? receiptError,
  };
}
```

### Using Raw Calldata with wagmi

```tsx
import { useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { type Address, type Hex } from "viem";

export function useMintWithCalldata() {
  const {
    sendTransaction,
    data: txHash,
    isPending,
    error: sendError,
  } = useSendTransaction();

  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  function mint(contractAddress: Address, calldata: Hex, value?: bigint) {
    sendTransaction({
      to: contractAddress,
      data: calldata,
      value: value ?? 0n,
    });
  }

  return {
    mint,
    txHash,
    isPending,
    isConfirming,
    isSuccess,
    error: sendError ?? receiptError,
  };
}
```

---

## 5. Complete NFT Minting Flow

End-to-end flow: connect wallet, generate image via backend, mint on-chain.

### Architecture Overview

```
User (Browser)                    Your Backend                  ChainGPT API
     |                                |                              |
     |-- Connect Wallet ------------->|                              |
     |-- "Generate my NFT" --------->|                              |
     |                                |-- POST /nft/generate-image ->|
     |                                |<- image bytes ---------------|
     |                                |-- POST /nft/generate-nft-queue ->|
     |                                |<- collectionId --------------|
     |                                |-- (poll progress) ---------->|
     |                                |<- completed -----------------|
     |                                |-- POST /nft/mint-nft ------->|
     |                                |<- ABI + contract + data -----|
     |<-- mint data (no API key) -----|                              |
     |                                                               |
     |-- Sign & send tx to chain ----------------------------------->|
     |<-- tx receipt <-----------------------------------------------|
```

### Backend API Route (Next.js App Router)

```typescript
// app/api/nft/prepare-mint/route.ts
import { NextRequest, NextResponse } from "next/server";

const CHAINGPT_API_KEY = process.env.CHAINGPT_API_KEY!;
const API_BASE = "https://api.chaingpt.org";

const headers = {
  Authorization: `Bearer ${CHAINGPT_API_KEY}`,
  "Content-Type": "application/json",
};

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { prompt, walletAddress, chainId } = body;

  // Validate inputs server-side
  if (!prompt || !walletAddress || !chainId) {
    return NextResponse.json(
      { error: "Missing required fields: prompt, walletAddress, chainId" },
      { status: 400 }
    );
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json(
      { error: "Invalid wallet address" },
      { status: 400 }
    );
  }

  try {
    // Step 1: Generate NFT via async queue
    const genRes = await fetch(`${API_BASE}/nft/generate-nft-queue`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt,
        model: "velogen",
        height: 512,
        width: 512,
        steps: 4,
        walletAddress,
        chainId,
        amount: 1,
      }),
    });

    if (!genRes.ok) {
      const err = await genRes.json();
      return NextResponse.json(
        { error: err.message ?? "Generation failed" },
        { status: genRes.status }
      );
    }

    const { collectionId } = await genRes.json();

    // Step 2: Poll until complete
    let status = "queued";
    while (status !== "completed") {
      await new Promise((r) => setTimeout(r, 3000));
      const progressRes = await fetch(
        `${API_BASE}/nft/progress/${collectionId}`,
        { headers }
      );
      const progress = await progressRes.json();
      status = progress.status;

      if (status === "failed") {
        return NextResponse.json(
          { error: "NFT generation failed" },
          { status: 500 }
        );
      }
    }

    // Step 3: Get mint data
    const mintRes = await fetch(`${API_BASE}/nft/mint-nft`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        collectionId,
        name: "AI NFT",
        description: "Generated with ChainGPT",
        symbol: "AINFT",
        ids: [1],
      }),
    });

    if (!mintRes.ok) {
      const err = await mintRes.json();
      return NextResponse.json(
        { error: err.message ?? "Mint preparation failed" },
        { status: mintRes.status }
      );
    }

    const mintData = await mintRes.json();

    // Step 4: Get ABI
    const abiRes = await fetch(`${API_BASE}/nft/abi`, { headers });
    const abi = await abiRes.json();

    // Return mint data to frontend (NO API key exposed)
    return NextResponse.json({
      collectionId,
      abi: abi.data,
      contractAddress: mintData.data.contractAddress,
      mintData: mintData.data.mintData,
      value: mintData.data.value ?? "0",
      nfts: mintData.data.nfts,
    });
  } catch (error) {
    console.error("NFT preparation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
```

### Frontend Component (React + wagmi)

```tsx
// components/NftMinter.tsx
"use client";

import { useState } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from "wagmi";
import { type Address, type Hex } from "viem";

const TARGET_CHAIN_ID = 56; // BSC — change per your needs

export function NftMinter() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const {
    sendTransactionAsync,
    data: txHash,
    isPending: isSigning,
  } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess } =
    useWaitForTransactionReceipt({ hash: txHash });

  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function handleMint() {
    if (!address) return;
    setError("");
    setStatus("");

    try {
      // 1. Switch chain if needed
      if (chainId !== TARGET_CHAIN_ID) {
        setStatus("Switching chain...");
        await switchChainAsync({ chainId: TARGET_CHAIN_ID });
      }

      // 2. Call backend to generate + prepare mint
      setStatus("Generating NFT image (this may take 15-30 seconds)...");
      const res = await fetch("/api/nft/prepare-mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          walletAddress: address,
          chainId: TARGET_CHAIN_ID,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to prepare mint");
      }

      const mintData = await res.json();

      // 3. Send the on-chain transaction
      setStatus("Please confirm the transaction in your wallet...");
      await sendTransactionAsync({
        to: mintData.contractAddress as Address,
        data: mintData.mintData as Hex,
        value: BigInt(mintData.value),
      });

      setStatus("Transaction submitted. Waiting for confirmation...");
    } catch (err: any) {
      setError(err.message ?? "Unknown error");
      setStatus("");
    }
  }

  if (!isConnected) {
    return <p>Connect your wallet to mint NFTs.</p>;
  }

  return (
    <div>
      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe your NFT..."
      />
      <button
        onClick={handleMint}
        disabled={!prompt || isSigning || isConfirming}
      >
        {isSigning
          ? "Confirm in wallet..."
          : isConfirming
            ? "Confirming..."
            : "Generate & Mint NFT"}
      </button>

      {status && <p>{status}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
      {isSuccess && txHash && (
        <p>
          Minted! Tx:{" "}
          <a
            href={`https://bscscan.com/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {txHash}
          </a>
        </p>
      )}
    </div>
  );
}
```

---

## 6. Chain Switching

ChainGPT NFT supports 22+ chains. The user's wallet must be on the correct chain
before they sign the mint transaction.

### Dynamic Chain Switching with wagmi

```tsx
import { useSwitchChain, useChainId } from "wagmi";

export function ChainSwitcher({ targetChainId }: { targetChainId: number }) {
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (chainId === targetChainId) return null;

  return (
    <button
      onClick={() => switchChain({ chainId: targetChainId })}
      disabled={isPending}
    >
      {isPending ? "Switching..." : `Switch to chain ${targetChainId}`}
    </button>
  );
}
```

### Chain Switching with ethers.js v6

```typescript
import { BrowserProvider } from "ethers";

async function ensureChain(
  targetChainId: number
): Promise<void> {
  const provider = new BrowserProvider(window.ethereum);
  const network = await provider.getNetwork();

  if (Number(network.chainId) === targetChainId) return;

  const hexChainId = "0x" + targetChainId.toString(16);

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }],
    });
  } catch (error: any) {
    if (error.code === 4902) {
      // Chain not in wallet — add it first
      // Use CHAIN_CONFIGS from Section 1
      const config = CHAIN_CONFIGS[targetChainId];
      if (!config) throw new Error(`Unknown chain: ${targetChainId}`);

      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [config],
      });
    } else {
      throw error;
    }
  }

  // Verify the switch succeeded
  const updatedProvider = new BrowserProvider(window.ethereum);
  const updatedNetwork = await updatedProvider.getNetwork();
  if (Number(updatedNetwork.chainId) !== targetChainId) {
    throw new Error("Chain switch was not completed");
  }
}
```

### Fetching Supported Chains from the API

Your backend can call `GET /nft/get-chains` and expose the list to the frontend:

```typescript
// Backend route: GET /api/supported-chains
export async function GET() {
  const res = await fetch(
    "https://api.chaingpt.org/nft/get-chains?testNet=false",
    {
      headers: { Authorization: `Bearer ${process.env.CHAINGPT_API_KEY}` },
    }
  );
  const chains = await res.json();
  // Forward the chain list (no sensitive data)
  return Response.json(chains.data);
}
```

---

## 7. Error Handling

### EIP-1193 Error Codes (Wallet Errors)

| Code | Name | Meaning |
|------|------|---------|
| 4001 | User Rejected | User denied the transaction or connection request |
| 4100 | Unauthorized | Wallet is locked or account not exposed |
| 4200 | Unsupported Method | Wallet does not support this RPC method |
| 4900 | Disconnected | Wallet lost connection to all chains |
| 4901 | Chain Disconnected | Wallet lost connection to the requested chain |
| 4902 | Unrecognized Chain | Chain not configured in the wallet (trigger addChain) |

### Unified Error Handler

```typescript
interface WalletError {
  code: string;
  title: string;
  message: string;
  recoverable: boolean;
}

function classifyWalletError(error: any): WalletError {
  const code = error?.code ?? error?.cause?.code;

  // User rejected the transaction
  if (code === 4001 || code === "ACTION_REJECTED") {
    return {
      code: "USER_REJECTED",
      title: "Transaction Cancelled",
      message: "You rejected the transaction. No gas was spent.",
      recoverable: true,
    };
  }

  // Wrong chain
  if (code === 4901 || code === 4902) {
    return {
      code: "WRONG_CHAIN",
      title: "Wrong Network",
      message: "Please switch to the correct network and try again.",
      recoverable: true,
    };
  }

  // Insufficient funds for gas
  if (
    error?.message?.includes("insufficient funds") ||
    error?.message?.includes("INSUFFICIENT_FUNDS")
  ) {
    return {
      code: "INSUFFICIENT_GAS",
      title: "Insufficient Balance",
      message:
        "Your wallet does not have enough native tokens to cover gas fees.",
      recoverable: false,
    };
  }

  // Transaction reverted on-chain
  if (
    error?.message?.includes("CALL_EXCEPTION") ||
    error?.message?.includes("execution reverted")
  ) {
    return {
      code: "TX_REVERTED",
      title: "Transaction Failed",
      message:
        "The smart contract reverted the transaction. The NFT may have already been minted, or the mint data may have expired.",
      recoverable: false,
    };
  }

  // Nonce too low (user has pending tx)
  if (error?.message?.includes("nonce")) {
    return {
      code: "NONCE_ERROR",
      title: "Pending Transaction",
      message:
        "You may have a pending transaction. Wait for it to confirm or speed it up in your wallet.",
      recoverable: true,
    };
  }

  // Generic fallback
  return {
    code: "UNKNOWN",
    title: "Transaction Error",
    message: error?.message ?? "An unexpected error occurred.",
    recoverable: false,
  };
}
```

### React Error Handling Hook

```tsx
import { useState, useCallback } from "react";

export function useWalletAction<T extends (...args: any[]) => Promise<any>>(
  action: T
) {
  const [error, setError] = useState<WalletError | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const execute = useCallback(
    async (...args: Parameters<T>) => {
      setError(null);
      setIsLoading(true);
      try {
        const result = await action(...args);
        return result;
      } catch (err) {
        const classified = classifyWalletError(err);
        setError(classified);
        throw classified;
      } finally {
        setIsLoading(false);
      }
    },
    [action]
  );

  return { execute, error, isLoading, clearError: () => setError(null) };
}
```

---

## 8. Security Best Practices

### Never Expose Your API Key to the Frontend

The ChainGPT API key has access to your credit balance and can generate images
on your behalf. It must stay on the server.

```
BAD:  fetch("https://api.chaingpt.org/nft/generate-image", {
        headers: { Authorization: `Bearer ${apiKey}` }  // Visible in DevTools
      })

GOOD: fetch("/api/nft/generate", { body: JSON.stringify({ prompt }) })
      // Your backend adds the Authorization header server-side
```

### Backend Proxy Pattern

```typescript
// Minimal Express proxy example
import express from "express";

const app = express();
app.use(express.json());

const API_KEY = process.env.CHAINGPT_API_KEY!;

// Rate limit per user session
const rateLimit = new Map<string, number>();

app.post("/api/nft/generate", async (req, res) => {
  const { prompt, walletAddress, chainId } = req.body;

  // 1. Validate wallet address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return res.status(400).json({ error: "Invalid wallet address" });
  }

  // 2. Sanitize prompt (strip HTML, limit length)
  const sanitizedPrompt = prompt
    .replace(/<[^>]*>/g, "")
    .slice(0, 500);

  // 3. Rate limit (example: 5 requests per minute per address)
  const key = walletAddress.toLowerCase();
  const now = Date.now();
  const lastRequest = rateLimit.get(key) ?? 0;
  if (now - lastRequest < 12_000) {
    return res.status(429).json({ error: "Too many requests" });
  }
  rateLimit.set(key, now);

  // 4. Forward to ChainGPT with server-side API key
  const response = await fetch(
    "https://api.chaingpt.org/nft/generate-nft-queue",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: sanitizedPrompt,
        model: "velogen",
        height: 512,
        width: 512,
        steps: 4,
        walletAddress,
        chainId,
        amount: 1,
      }),
    }
  );

  const data = await response.json();
  res.status(response.status).json(data);
});
```

### Validate Addresses On-Chain

Do not trust addresses from the frontend without validation:

```typescript
import { isAddress, getAddress } from "viem";

function validateAndChecksum(address: string): `0x${string}` {
  if (!isAddress(address)) {
    throw new Error("Invalid Ethereum address");
  }
  // getAddress returns EIP-55 checksummed form
  return getAddress(address);
}
```

### Content Security Checklist

| Risk | Mitigation |
|------|------------|
| API key in client bundle | Use server-side proxy; never import API key in frontend code |
| Prompt injection | Sanitize and length-limit prompts before forwarding to API |
| Replay attacks on mint data | Mint data is single-use; backend should track used collectionIds |
| Unauthorized minting | Verify the requesting wallet matches the walletAddress in mint data |
| Phishing via fake contracts | Always fetch ABI and contract address from the ChainGPT API, never hardcode |
| Front-running | Mint transactions go through standard mempool; consider private RPCs for high-value mints |

### Environment Variables

```bash
# .env.local (never commit this file)
CHAINGPT_API_KEY=your-api-key-here
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-walletconnect-project-id

# NEXT_PUBLIC_ prefix makes it available in the browser — only use for
# non-secret values like the WalletConnect project ID.
# CHAINGPT_API_KEY has no prefix, so it stays server-side only.
```

---

## Quick Reference: Supported Chain IDs

For the full up-to-date list, call `GET /nft/get-chains?testNet=false`.

| Chain | ID | Native Token |
|-------|----|-------------|
| Ethereum | 1 | ETH |
| Cronos | 25 | CRO |
| BSC | 56 | BNB |
| Viction | 88 | VIC |
| Polygon | 137 | POL |
| Sonic | 146 | S |
| X Layer | 196 | OKB |
| BTTC | 199 | BTT |
| opBNB | 204 | BNB |
| Hedera | 295 | HBAR |
| 5ire | 995 | 5IRE |
| COREDAO | 1116 | CORE |
| Sei | 1329 | SEI |
| Mantle | 5000 | MNT |
| Base | 8453 | ETH |
| Immutable | 13371 | IMX |
| Arbitrum | 42161 | ETH |
| Avalanche | 43114 | AVAX |
| Linea | 59144 | ETH |
| Bera Chain | 80094 | BERA |
| Scroll | 534352 | ETH |
| SKALE | 1350216234 | sFUEL |
