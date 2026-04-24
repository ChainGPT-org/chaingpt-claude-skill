# ChainGPT Smart Contract Pattern Library

Production-ready Solidity patterns that Claude can compose from when generating smart contracts via ChainGPT's Contract Generator and Auditor.

## Overview

This library contains **45+ audited patterns** organized into 6 categories. Each pattern includes:

- Complete Solidity 0.8.x code (MIT licensed)
- OpenZeppelin v5.x imports where applicable
- NatSpec documentation
- Security considerations and known attack vectors
- Gas optimization notes
- Constructor parameters and deployment guidance

## Categories

| # | Category | File | Patterns | Description |
|---|----------|------|----------|-------------|
| 1 | **Tokens** | [tokens.md](tokens.md) | 10 | ERC-20 variants: basic, burnable, capped, taxable, reflection, deflationary, role-based, vesting, governance, multi-chain |
| 2 | **NFTs** | [nfts.md](nfts.md) | 10 | ERC-721 and ERC-1155: basic, on-chain metadata, gas-optimized (721A), lazy mint, soulbound, dynamic, multi-token, royalty, allowlist, revenue-sharing |
| 3 | **DeFi** | [defi.md](defi.md) | 10 | Staking pools, vesting schedules, bonding curves, AMMs, ERC-4626 vaults, flash loans, token swaps |
| 4 | **Governance** | [governance.md](governance.md) | 5 | OpenZeppelin Governor, simple voting, multi-sig, treasury, delegation |
| 5 | **Security** | [security.md](security.md) | 10 | Access control, pausable, UUPS upgradeable, timelock, rate limiter, escrow, pull payment, reentrancy guard, EIP-712, ERC-2612 |
| **Total** | | | **45+** | |

## Usage with ChainGPT

### Contract Generator
When generating contracts via the ChainGPT Smart Contract Generator API, these patterns serve as the canonical reference. Claude composes from these building blocks to produce custom contracts.

### Contract Auditor
When auditing contracts via the ChainGPT Smart Contract Auditor API, these patterns define the expected secure implementations. Deviations from these patterns are flagged as potential issues.

### Composability
Patterns are designed to be composed. For example:
- **Taxable ERC-20** + **Role-Based Access Control** + **Pausable** = Production token with fees, admin roles, and emergency stop
- **ERC-721 with Royalty** + **Allowlist Mint** + **Pausable** = Full NFT launch contract
- **Staking Pool** + **Timelock** + **Multi-Sig** = Secured DeFi staking with governance controls

## Compiler Settings

All patterns target:
- **Solidity:** `^0.8.20` (or higher where noted)
- **Optimizer:** 200 runs (balance deployment cost vs. runtime gas)
- **EVM Version:** Shanghai (default for 0.8.20+)
- **License:** MIT (SPDX identifier included in every file)

## OpenZeppelin Version

All imports reference `@openzeppelin/contracts` v5.x:
```
npm install @openzeppelin/contracts@^5.0.0
```

For upgradeable contracts:
```
npm install @openzeppelin/contracts-upgradeable@^5.0.0
```

## Security Disclaimer

These patterns have been reviewed for common vulnerabilities but should always be:
1. Audited by a professional auditor before mainnet deployment
2. Tested thoroughly with unit and integration tests
3. Deployed to testnet first with full scenario coverage
4. Monitored post-deployment with alerting on critical events

## Pattern Index

### Tokens (tokens.md)
1. Basic ERC-20 -- Standard mintable token
2. Burnable ERC-20 -- Token with burn capability
3. Capped ERC-20 -- Fixed maximum supply
4. Taxable ERC-20 -- Transfer tax with configurable rates
5. Reflection Token -- Auto-distribution to holders (SafeMoon-style)
6. Deflationary Token -- Burn on every transfer
7. Mintable with Roles -- AccessControl-based minting
8. Vesting Token -- Built-in linear vesting
9. Governance Token -- ERC20Votes + ERC20Permit
10. Multi-chain Token -- Bridge-compatible mint/burn

### NFTs (nfts.md)
11. Basic ERC-721 -- Simple mintable NFT
12. On-Chain Metadata ERC-721 -- Base64 JSON + SVG on-chain
13. ERC-721A Gas-Optimized -- Batch minting (Azuki pattern)
14. Lazy Mint ERC-721 -- Signature-based lazy minting
15. Soulbound Token (SBT) -- Non-transferable NFT
16. Dynamic NFT -- Metadata changes based on on-chain state
17. ERC-1155 Multi-Token -- Fungible + non-fungible combined
18. Royalty NFT (ERC-2981) -- EIP-2981 royalty standard
19. Allowlist Mint -- Merkle proof-based phases
20. Revenue-Sharing NFT -- Proportional revenue splits

### DeFi (defi.md)
21. Simple Staking Pool -- Stake A, earn B
22. Flexible Staking -- Multiple pools with lock periods
23. Linear Vesting -- Time-based linear release
24. Cliff + Linear Vesting -- Cliff then linear
25. Milestone Vesting -- Release at specific dates
26. Bonding Curve -- Continuous token model
27. Constant Product AMM -- Basic x*y=k liquidity pool
28. Yield Aggregator Vault -- ERC-4626 tokenized vault
29. Flash Loan Pool -- ERC-3156 flash loan provider
30. Token Swap -- OTC swap with deadline

### Governance (governance.md)
31. Governor (OpenZeppelin) -- Full Governor + TimelockController
32. Simple Voting -- Proposal + vote + execute
33. Multi-Sig Wallet -- N-of-M signatures
34. Treasury -- DAO-controlled spending
35. Delegation -- Snapshot-based vote delegation

### Security (security.md)
36. Role-Based Access Control -- Multiple roles with admin hierarchy
37. Pausable Contract -- Emergency pause/unpause
38. UUPS Upgradeable -- Proxy pattern for upgradeability
39. Timelock -- Delayed execution
40. Rate Limiter -- Per-address call limits
41. Escrow -- Conditional fund release with arbiter
42. Pull Payment -- Withdrawal pattern
43. Reentrancy Guard -- CEI pattern with guard
44. Signature Verification -- EIP-712 typed data
45. Permit (ERC-2612) -- Gasless approvals
