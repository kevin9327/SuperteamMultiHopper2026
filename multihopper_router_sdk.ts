/**
 * HopperPay Enterprise Treasury & Agentic Multi-Send Router SDK for MultiHopper
 * =============================================================================
 * Built for the MultiHopper Build & Route Challenge (Up to $50,000 + 0.25% Revenue Share)
 *
 * Official On-Chain Solana Program IDs (Mainnet-Beta):
 * - MultiHopper Core:     3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh
 * - Orchestrator:         4TPCmR2uN3hDM1FbTsf7ZtFXwXGSz4u1Kxv5YHj6eruX
 * - Transfer Hook Guard:  2JEv3pD6nczEvn1xDXaEzehkJofPPjoQQpnW5nGY3r52
 * - Hosted MCP Server:    https://multihopper.com/api/mcp
 */

export const MULTIHOPPER_PROGRAMS = {
  CORE: "3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh",
  ORCHESTRATOR: "4TPCmR2uN3hDM1FbTsf7ZtFXwXGSz4u1Kxv5YHj6eruX",
  TRANSFER_HOOK_GUARD: "2JEv3pD6nczEvn1xDXaEzehkJofPPjoQQpnW5nGY3r52",
  MCP_API_URL: "https://multihopper.com/api/mcp",
  MCP_DOCS_URL: "https://dev-docs.multihopper.com/mcp",
  MAINNET_API_BASE: "https://multihopper.com/api/v1",
  DEVNET_API_BASE: "https://devnet.multihopper.com/api/v1",
} as const;

export type HopBundleCategory = "cex" | "dex" | "exchanges" | "kol" | "contracts" | "mix";

export interface CustomHopSpec {
  wallet?: string;
  bundle?: HopBundleCategory;
  waitSeconds: number;
}

export interface MultiDestinationShare {
  wallet: string;
  amountRaw: string;
  label?: string;
}

export interface EstimateTransferRequest {
  tokenMint: string;
  amountRaw: string;
  tokenDecimals: number;
  hops: number;
  destinationCount?: number;
  arrivalSeconds?: number;
  route?: { hops: CustomHopSpec[] };
  routeTemplateId?: string;
}

export interface EstimateTransferResponse {
  tierIndex: number;
  usdValueMicros: string;
  priceSource: "onchain_pool" | "fallback";
  cappedAtTierBoundary: boolean;
  hopAmountRaw: string;
  percentFeeBps: number; // 50 bps = 0.50% (25 bps = 0.25% paid atomically to Provider on-chain)
  percentFeeRaw: string;
  integratorRevenueRaw: string;
  protocolPoolShareRaw: string;
  perHopFeeLamports: number;
  totalFlatFeeLamports: number;
  trmRescreenRequired: boolean;
  sol: {
    requiredSolUpFrontLamports: number;
    breakdown: {
      routeRentLamports: number;
      keeperFundingLamports: number;
      dispersionRentLamports: number;
      txFeeLamports: number;
    };
  };
}

export interface CreateTransferRequest {
  tokenMint: string;
  amountRaw: string;
  amountTokens: string;
  tokenDecimals: number;
  tokenSymbol: string;
  sourceOwner: string;
  recipientWallet?: string;
  destinations?: MultiDestinationShare[];
  hops: number;
  arrivalSeconds: number;
  route?: { hops: CustomHopSpec[] };
  routeTemplateId?: string;
  externalId: string;
}

export interface PreparedTransferBundle {
  transferId: number;
  status: "awaiting_signature";
  preparedTxs: {
    keeperFundingTx: string;
    routeInitTxs: { base64: string }[];
    orchestratorInitTx: string;
    sessionInitTxs: string[];
    dispersionInitTxs?: string[];
    recentBlockhash: string;
    lastValidBlockHeight: number;
  };
}

/**
 * Validates MultiHopper Multi-Destination transfer invariants before calling POST /api/v1/transfers:
 * 1. Exactly one of `recipientWallet` or `destinations` must be provided (never both).
 * 2. `destinations` length must be in [1, 20], wallets must be unique, and `amountRaw` shares
 *    must sum exactly to the transfer's total `amountRaw` (avoids MH_041).
 * 3. `hops` must be in [3, 10] and `arrivalSeconds` in [60, 2592000].
 */
export function validateTransferPayload(req: CreateTransferRequest): { valid: boolean; errorCode?: string; message?: string } {
  const hasSingle = Boolean(req.recipientWallet);
  const hasMulti = Array.isArray(req.destinations) && req.destinations.length > 0;
  if (hasSingle === hasMulti) {
    return {
      valid: false,
      errorCode: "MH_INVALID_RECIPIENT_MODE",
      message: "Specify exactly one of recipientWallet or destinations, never both.",
    };
  }
  if (req.hops < 3 || req.hops > 10) {
    return { valid: false, errorCode: "MH_018", message: "hops must be between 3 and 10." };
  }
  if (req.arrivalSeconds < 60 || req.arrivalSeconds > 2_592_000) {
    return { valid: false, errorCode: "MH_018", message: "arrivalSeconds must be between 60 and 2,592,000." };
  }
  if (hasMulti && req.destinations) {
    if (req.destinations.length > 20) {
      return { valid: false, errorCode: "MH_041", message: "destinations cannot exceed 20 recipients per route." };
    }
    const seen = new Set<string>();
    let sum = 0n;
    for (const d of req.destinations) {
      if (seen.has(d.wallet)) {
        return { valid: false, errorCode: "MH_041", message: `Duplicate destination wallet: ${d.wallet}` };
      }
      seen.add(d.wallet);
      sum += BigInt(d.amountRaw);
    }
    if (sum !== BigInt(req.amountRaw)) {
      return {
        valid: false,
        errorCode: "MH_041",
        message: `Destination shares sum (${sum.toString()}) !== amountRaw (${req.amountRaw}).`,
      };
    }
  }
  return { valid: true };
}
