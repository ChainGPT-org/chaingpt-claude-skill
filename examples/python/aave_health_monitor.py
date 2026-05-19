"""
Aave V3 health-factor monitor — Python.

Polls a list of wallet addresses across Aave V3 deployments and prints any
position whose health factor is below a warning threshold. Useful as a starting
point for a Telegram-bot alerter or a cron job.

Demonstrates the read-only pattern Claude follows before any borrow / withdraw:
always check the user's HF first, surface liquidation risk loudly, and refuse
the action if HF would drop below 1.05.

Run:
    pip install web3
    python examples/python/aave_health_monitor.py
"""

from web3 import Web3

# Aave V3 Pool addresses per chain
POOLS = {
    "ethereum": ("0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2", "https://ethereum-rpc.publicnode.com"),
    "base":     ("0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", "https://mainnet.base.org"),
    "arbitrum": ("0x794a61358D6845594F94dc1DB02A252b5b4814aD", "https://arb1.arbitrum.io/rpc"),
    "optimism": ("0x794a61358D6845594F94dc1DB02A252b5b4814aD", "https://mainnet.optimism.io"),
    "polygon":  ("0x794a61358D6845594F94dc1DB02A252b5b4814aD", "https://polygon-rpc.com"),
    "avalanche":("0x794a61358D6845594F94dc1DB02A252b5b4814aD", "https://api.avax.network/ext/bc/C/rpc"),
    "bsc":      ("0x6807dc923806fE8Fd134338EABCA509979a7e0cB", "https://bsc-dataseed.binance.org"),
}

# Minimal ABI for getUserAccountData
POOL_ABI = [{
    "inputs": [{"name": "user", "type": "address"}],
    "name": "getUserAccountData",
    "outputs": [
        {"name": "totalCollateralBase", "type": "uint256"},
        {"name": "totalDebtBase", "type": "uint256"},
        {"name": "availableBorrowsBase", "type": "uint256"},
        {"name": "currentLiquidationThreshold", "type": "uint256"},
        {"name": "ltv", "type": "uint256"},
        {"name": "healthFactor", "type": "uint256"},
    ],
    "stateMutability": "view",
    "type": "function",
}]

UINT256_MAX = (1 << 256) - 1
WARN_BELOW = 1.5     # ℹ warn band
CRITICAL_BELOW = 1.05  # ⚠ critical band


def health(network: str, user: str) -> dict | None:
    pool_addr, rpc_url = POOLS[network]
    w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 10}))
    pool = w3.eth.contract(address=Web3.to_checksum_address(pool_addr), abi=POOL_ABI)
    try:
        data = pool.functions.getUserAccountData(Web3.to_checksum_address(user)).call()
    except Exception as e:
        print(f"  {network}: read failed — {e}")
        return None
    collateral_usd = data[0] / 1e8
    debt_usd = data[1] / 1e8
    if collateral_usd == 0 and debt_usd == 0:
        return None  # no position on this chain
    hf_raw = data[5]
    hf = float("inf") if hf_raw == UINT256_MAX else hf_raw / 1e18
    return {
        "network": network,
        "user": user,
        "collateral_usd": collateral_usd,
        "debt_usd": debt_usd,
        "available_borrows_usd": data[2] / 1e8,
        "ltv_pct": data[4] / 100,
        "liq_threshold_pct": data[3] / 100,
        "health_factor": hf,
    }


def report(positions: list[dict]) -> None:
    if not positions:
        print("No open Aave positions across the monitored wallets + chains.")
        return
    positions.sort(key=lambda p: (p["health_factor"], -p["debt_usd"]))
    for p in positions:
        hf = p["health_factor"]
        if hf == float("inf"):
            tag = "✓"
            hf_str = "∞ (no debt)"
        elif hf < CRITICAL_BELOW:
            tag = "⚠ CRITICAL"
            hf_str = f"{hf:.3f}"
        elif hf < WARN_BELOW:
            tag = "ℹ WARN"
            hf_str = f"{hf:.3f}"
        else:
            tag = "✓"
            hf_str = f"{hf:.3f}"
        print(
            f"{tag:>11}  {p['user'][:8]}…  {p['network']:10}  "
            f"collateral=${p['collateral_usd']:>10,.2f}  "
            f"debt=${p['debt_usd']:>10,.2f}  HF={hf_str}"
        )


if __name__ == "__main__":
    # Replace with the wallets you want to monitor.
    WALLETS = [
        "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",  # Vitalik (no Aave position; just a demo)
    ]

    positions = []
    for w in WALLETS:
        for chain in POOLS:
            pos = health(chain, w)
            if pos:
                positions.append(pos)
    print(f"\n══ Aave V3 health monitor — {len(WALLETS)} wallet(s) × {len(POOLS)} chains ══\n")
    report(positions)
    print()
