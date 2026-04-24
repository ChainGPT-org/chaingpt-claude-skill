# Token Patterns (ERC-20 Variants)

Complete, production-ready ERC-20 token patterns for the ChainGPT Contract Generator.

---

## 1. Basic ERC-20

Standard ERC-20 token with owner-only minting.

**When to use:** Simple utility or payment token with controlled supply expansion.

**Security considerations:**
- Only owner can mint; ensure owner key is secured (multisig recommended)
- No max supply cap -- add one if needed to prevent unlimited inflation

**Gas optimization:** Minimal overhead. ~$5-10 deployment on L2s.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BasicERC20
 * @author ChainGPT Pattern Library
 * @notice Standard ERC-20 token with owner-controlled minting.
 * @dev Extends OpenZeppelin ERC20 and Ownable.
 *      Owner can mint new tokens without supply cap.
 */
contract BasicERC20 is ERC20, Ownable {
    /**
     * @param name_ Token name (e.g., "ChainGPT Token")
     * @param symbol_ Token symbol (e.g., "CGPT")
     * @param initialSupply_ Initial supply minted to deployer (in whole tokens, not wei)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        _mint(msg.sender, initialSupply_ * 10 ** decimals());
    }

    /**
     * @notice Mint new tokens to a specified address.
     * @param to Recipient address
     * @param amount Amount in wei (smallest unit)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
```

**Constructor parameters:**
| Parameter | Type | Example |
|-----------|------|---------|
| `name_` | string | `"ChainGPT Token"` |
| `symbol_` | string | `"CGPT"` |
| `initialSupply_` | uint256 | `1000000` (1M tokens) |

**Key functions:** `mint(address, uint256)`, `transfer`, `approve`, `transferFrom` (inherited)

**Events:** `Transfer`, `Approval` (inherited from ERC20)

---

## 2. Burnable ERC-20

ERC-20 with burn capability for any token holder.

**When to use:** Deflationary tokenomics where holders voluntarily reduce supply.

**Security considerations:**
- Any holder can burn their own tokens -- this is by design
- `burnFrom` requires prior approval -- standard allowance pattern
- Burns are irreversible

**Gas optimization:** Burn adds ~5k gas to a destroy operation. No storage overhead.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BurnableERC20
 * @author ChainGPT Pattern Library
 * @notice ERC-20 token where any holder can burn their tokens.
 * @dev Inherits ERC20Burnable which provides burn() and burnFrom().
 */
contract BurnableERC20 is ERC20, ERC20Burnable, Ownable {
    /**
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param initialSupply_ Initial supply in whole tokens
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        _mint(msg.sender, initialSupply_ * 10 ** decimals());
    }

    /**
     * @notice Mint new tokens. Owner only.
     * @param to Recipient
     * @param amount Amount in wei
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
```

**Key functions:** `burn(uint256)`, `burnFrom(address, uint256)`, `mint(address, uint256)`

---

## 3. Capped ERC-20

ERC-20 with a hard maximum supply that cannot be exceeded.

**When to use:** Fixed-supply tokenomics where total supply must never exceed a cap (e.g., 100M tokens).

**Security considerations:**
- Cap is immutable once deployed -- cannot be changed
- Minting reverts if it would exceed cap
- Set cap carefully; too low = cannot mint enough, too high = meaningless

**Gas optimization:** Cap check adds ~200 gas per mint call. Negligible.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CappedERC20
 * @author ChainGPT Pattern Library
 * @notice ERC-20 with a hard maximum supply cap.
 * @dev ERC20Capped enforces the cap on every _mint call.
 */
contract CappedERC20 is ERC20, ERC20Capped, Ownable {
    /**
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param cap_ Maximum total supply in whole tokens
     * @param initialSupply_ Initial supply minted to deployer (must be <= cap_)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 cap_,
        uint256 initialSupply_
    )
        ERC20(name_, symbol_)
        ERC20Capped(cap_ * 10 ** 18)
        Ownable(msg.sender)
    {
        require(initialSupply_ <= cap_, "Initial supply exceeds cap");
        _mint(msg.sender, initialSupply_ * 10 ** decimals());
    }

    /**
     * @notice Mint new tokens up to the cap.
     * @param to Recipient
     * @param amount Amount in wei
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Required override for ERC20Capped.
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }
}
```

**Constructor parameters:**
| Parameter | Type | Example |
|-----------|------|---------|
| `cap_` | uint256 | `100000000` (100M) |
| `initialSupply_` | uint256 | `50000000` (50M) |

---

## 4. Taxable ERC-20

Transfer tax with configurable buy/sell rates and a tax recipient address.

**When to use:** Tokens that collect fees on transfers (common in DeFi/meme tokens). Tax goes to a treasury or marketing wallet.

**Security considerations:**
- **CRITICAL:** Tax cannot exceed 25% (MAX_TAX) to prevent honeypot behavior
- Owner can update rates but cannot exceed max -- this is enforced on-chain
- Tax is skipped for owner and taxRecipient to prevent double-taxation loops
- DEX pair addresses should be tracked to differentiate buy vs sell tax
- Audit for sandwich attack vectors when tax rates are high

**Gas optimization:** ~8k extra gas per taxed transfer due to split logic. Tax-exempt addresses save this cost.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TaxableERC20
 * @author ChainGPT Pattern Library
 * @notice ERC-20 with configurable buy/sell transfer tax.
 * @dev Tax is deducted from transfer amount and sent to taxRecipient.
 *      Maximum tax is capped at 25% to prevent honeypot contracts.
 */
contract TaxableERC20 is ERC20, Ownable {
    uint256 public constant MAX_TAX = 2500; // 25% in basis points
    uint256 public constant BASIS_POINTS = 10000;

    uint256 public buyTax;   // basis points (100 = 1%)
    uint256 public sellTax;  // basis points
    address public taxRecipient;

    mapping(address => bool) public isDexPair;
    mapping(address => bool) public isExcludedFromTax;

    event TaxUpdated(uint256 buyTax, uint256 sellTax);
    event TaxRecipientUpdated(address indexed newRecipient);
    event DexPairUpdated(address indexed pair, bool status);
    event ExclusionUpdated(address indexed account, bool excluded);

    /**
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param initialSupply_ Initial supply in whole tokens
     * @param buyTax_ Buy tax in basis points (e.g., 300 = 3%)
     * @param sellTax_ Sell tax in basis points
     * @param taxRecipient_ Address that receives collected tax
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        uint256 buyTax_,
        uint256 sellTax_,
        address taxRecipient_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        require(buyTax_ <= MAX_TAX, "Buy tax too high");
        require(sellTax_ <= MAX_TAX, "Sell tax too high");
        require(taxRecipient_ != address(0), "Zero tax recipient");

        buyTax = buyTax_;
        sellTax = sellTax_;
        taxRecipient = taxRecipient_;

        isExcludedFromTax[msg.sender] = true;
        isExcludedFromTax[taxRecipient_] = true;

        _mint(msg.sender, initialSupply_ * 10 ** decimals());
    }

    /**
     * @notice Update buy and sell tax rates.
     * @param buyTax_ New buy tax in basis points
     * @param sellTax_ New sell tax in basis points
     */
    function setTaxRates(uint256 buyTax_, uint256 sellTax_) external onlyOwner {
        require(buyTax_ <= MAX_TAX, "Buy tax too high");
        require(sellTax_ <= MAX_TAX, "Sell tax too high");
        buyTax = buyTax_;
        sellTax = sellTax_;
        emit TaxUpdated(buyTax_, sellTax_);
    }

    /**
     * @notice Update the address that receives tax.
     * @param newRecipient New tax recipient address
     */
    function setTaxRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "Zero address");
        isExcludedFromTax[taxRecipient] = false;
        taxRecipient = newRecipient;
        isExcludedFromTax[newRecipient] = true;
        emit TaxRecipientUpdated(newRecipient);
    }

    /**
     * @notice Mark or unmark an address as a DEX pair (for buy/sell detection).
     */
    function setDexPair(address pair, bool status) external onlyOwner {
        isDexPair[pair] = status;
        emit DexPairUpdated(pair, status);
    }

    /**
     * @notice Exclude or include an address from tax.
     */
    function setExcluded(address account, bool excluded) external onlyOwner {
        isExcludedFromTax[account] = excluded;
        emit ExclusionUpdated(account, excluded);
    }

    /**
     * @dev Override transfer to apply tax logic.
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        if (
            amount == 0 ||
            isExcludedFromTax[from] ||
            isExcludedFromTax[to] ||
            (from == address(0)) || // mint
            (to == address(0))      // burn
        ) {
            super._update(from, to, amount);
            return;
        }

        uint256 taxRate;
        if (isDexPair[from]) {
            // Buying from DEX
            taxRate = buyTax;
        } else if (isDexPair[to]) {
            // Selling to DEX
            taxRate = sellTax;
        }
        // Wallet-to-wallet: no tax (taxRate stays 0)

        if (taxRate > 0) {
            uint256 taxAmount = (amount * taxRate) / BASIS_POINTS;
            uint256 netAmount = amount - taxAmount;
            super._update(from, taxRecipient, taxAmount);
            super._update(from, to, netAmount);
        } else {
            super._update(from, to, amount);
        }
    }
}
```

**Constructor parameters:**
| Parameter | Type | Example |
|-----------|------|---------|
| `buyTax_` | uint256 | `300` (3%) |
| `sellTax_` | uint256 | `500` (5%) |
| `taxRecipient_` | address | Treasury/marketing wallet |

---

## 5. Reflection Token

Auto-distributes a percentage of each transfer to all holders proportionally (SafeMoon-style).

**When to use:** Reward-holding tokenomics where passive income accrues to holders.

**Security considerations:**
- Complex math -- ensure no rounding exploits with very small or very large balances
- Excluded addresses (e.g., DEX pairs, dead wallet) do not earn reflections
- Tax fee is hard-capped at 15% to prevent honeypot
- High reflection fees discourage trading and can create illiquid markets
- This pattern is gas-intensive; consider simpler reward mechanisms for L1 deployment

**Gas optimization:** Uses reflected-amount accounting (rAmount/tAmount) to avoid iterating holders. Adds ~20k gas per transfer.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title ReflectionToken
 * @author ChainGPT Pattern Library
 * @notice Reflection token that auto-distributes a fee to all holders.
 * @dev Uses a reflected supply mechanism to avoid O(n) distribution.
 *      Inspired by SafeMoon / reflect.finance pattern.
 */
contract ReflectionToken is IERC20, Ownable {
    string private _name;
    string private _symbol;
    uint8 private constant _decimals = 18;

    uint256 private constant MAX = type(uint256).max;
    uint256 private _tTotal;
    uint256 private _rTotal;
    uint256 private _tFeeTotal;

    uint256 public taxFee; // basis points, max 1500 (15%)
    uint256 public constant MAX_FEE = 1500;
    uint256 public constant BASIS_POINTS = 10000;

    mapping(address => uint256) private _rOwned;
    mapping(address => uint256) private _tOwned;
    mapping(address => mapping(address => uint256)) private _allowances;
    mapping(address => bool) private _isExcluded;
    address[] private _excluded;

    event FeeUpdated(uint256 newFee);

    /**
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param totalSupply_ Total supply in whole tokens
     * @param taxFee_ Reflection fee in basis points (e.g., 200 = 2%)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        uint256 taxFee_
    ) Ownable(msg.sender) {
        require(taxFee_ <= MAX_FEE, "Fee too high");
        _name = name_;
        _symbol = symbol_;
        _tTotal = totalSupply_ * 10 ** _decimals;
        _rTotal = (MAX - (MAX % _tTotal));
        taxFee = taxFee_;

        _rOwned[msg.sender] = _rTotal;
        emit Transfer(address(0), msg.sender, _tTotal);
    }

    function name() public view returns (string memory) { return _name; }
    function symbol() public view returns (string memory) { return _symbol; }
    function decimals() public pure returns (uint8) { return _decimals; }
    function totalSupply() public view override returns (uint256) { return _tTotal; }

    function balanceOf(address account) public view override returns (uint256) {
        if (_isExcluded[account]) return _tOwned[account];
        return _tokenFromReflection(_rOwned[account]);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function allowance(address owner_, address spender) public view override returns (uint256) {
        return _allowances[owner_][spender];
    }

    function approve(address spender, uint256 amount) public override returns (bool) {
        _approve(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "ERC20: transfer amount exceeds allowance");
        unchecked {
            _approve(from, msg.sender, currentAllowance - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    function totalFees() public view returns (uint256) { return _tFeeTotal; }

    function setTaxFee(uint256 fee) external onlyOwner {
        require(fee <= MAX_FEE, "Fee too high");
        taxFee = fee;
        emit FeeUpdated(fee);
    }

    function excludeFromReward(address account) external onlyOwner {
        require(!_isExcluded[account], "Already excluded");
        if (_rOwned[account] > 0) {
            _tOwned[account] = _tokenFromReflection(_rOwned[account]);
        }
        _isExcluded[account] = true;
        _excluded.push(account);
    }

    function includeInReward(address account) external onlyOwner {
        require(_isExcluded[account], "Not excluded");
        for (uint256 i = 0; i < _excluded.length; i++) {
            if (_excluded[i] == account) {
                _excluded[i] = _excluded[_excluded.length - 1];
                _excluded.pop();
                break;
            }
        }
        _tOwned[account] = 0;
        _isExcluded[account] = false;
    }

    function _tokenFromReflection(uint256 rAmount) private view returns (uint256) {
        require(rAmount <= _rTotal, "Amount exceeds total reflections");
        uint256 currentRate = _getRate();
        return rAmount / currentRate;
    }

    function _approve(address owner_, address spender, uint256 amount) private {
        require(owner_ != address(0), "ERC20: approve from zero");
        require(spender != address(0), "ERC20: approve to zero");
        _allowances[owner_][spender] = amount;
        emit Approval(owner_, spender, amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(from != address(0), "ERC20: transfer from zero");
        require(to != address(0), "ERC20: transfer to zero");
        require(amount > 0, "Transfer amount must be > 0");

        uint256 tFee = (amount * taxFee) / BASIS_POINTS;
        uint256 tTransferAmount = amount - tFee;
        uint256 currentRate = _getRate();
        uint256 rAmount = amount * currentRate;
        uint256 rFee = tFee * currentRate;
        uint256 rTransferAmount = rAmount - rFee;

        _rOwned[from] -= rAmount;
        _rOwned[to] += rTransferAmount;

        if (_isExcluded[from]) _tOwned[from] -= amount;
        if (_isExcluded[to]) _tOwned[to] += tTransferAmount;

        _rTotal -= rFee;
        _tFeeTotal += tFee;

        emit Transfer(from, to, tTransferAmount);
    }

    function _getRate() private view returns (uint256) {
        (uint256 rSupply, uint256 tSupply) = _getCurrentSupply();
        return rSupply / tSupply;
    }

    function _getCurrentSupply() private view returns (uint256, uint256) {
        uint256 rSupply = _rTotal;
        uint256 tSupply = _tTotal;
        for (uint256 i = 0; i < _excluded.length; i++) {
            if (_rOwned[_excluded[i]] > rSupply || _tOwned[_excluded[i]] > tSupply) {
                return (_rTotal, _tTotal);
            }
            rSupply -= _rOwned[_excluded[i]];
            tSupply -= _tOwned[_excluded[i]];
        }
        if (rSupply < _rTotal / _tTotal) return (_rTotal, _tTotal);
        return (rSupply, tSupply);
    }
}
```

---

## 6. Deflationary Token

Burns a percentage of tokens on every transfer, permanently reducing supply.

**When to use:** Deflationary tokenomics where supply decreases over time.

**Security considerations:**
- Burn rate is capped at 10% (1000 bps) to prevent excessive value destruction
- Transfer to/from zero address is exempt (minting and explicit burns)
- Owner exclusion prevents issues with contract management
- Very small transfers may result in zero burn due to integer division

**Gas optimization:** ~5k extra gas per transfer for the burn calculation and event.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title DeflationaryToken
 * @author ChainGPT Pattern Library
 * @notice ERC-20 that burns a percentage of every transfer.
 * @dev Burn is applied in _update override. Max burn rate: 10%.
 */
contract DeflationaryToken is ERC20, Ownable {
    uint256 public burnRate; // basis points (100 = 1%)
    uint256 public constant MAX_BURN_RATE = 1000; // 10%
    uint256 public constant BASIS_POINTS = 10000;

    mapping(address => bool) public isExcluded;

    event BurnRateUpdated(uint256 newRate);

    /**
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param initialSupply_ Supply in whole tokens
     * @param burnRate_ Burn rate in basis points (e.g., 100 = 1%)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        uint256 burnRate_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        require(burnRate_ <= MAX_BURN_RATE, "Burn rate too high");
        burnRate = burnRate_;
        isExcluded[msg.sender] = true;
        _mint(msg.sender, initialSupply_ * 10 ** decimals());
    }

    function setBurnRate(uint256 newRate) external onlyOwner {
        require(newRate <= MAX_BURN_RATE, "Burn rate too high");
        burnRate = newRate;
        emit BurnRateUpdated(newRate);
    }

    function setExcluded(address account, bool excluded) external onlyOwner {
        isExcluded[account] = excluded;
    }

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        if (
            burnRate == 0 ||
            from == address(0) ||
            to == address(0) ||
            isExcluded[from] ||
            isExcluded[to]
        ) {
            super._update(from, to, amount);
            return;
        }

        uint256 burnAmount = (amount * burnRate) / BASIS_POINTS;
        uint256 netAmount = amount - burnAmount;

        // Burn
        super._update(from, address(0), burnAmount);
        // Transfer remaining
        super._update(from, to, netAmount);
    }
}
```

---

## 7. Mintable with Roles

ERC-20 with AccessControl allowing multiple minter addresses.

**When to use:** Multi-party minting (e.g., staking contract mints rewards, bridge mints cross-chain tokens).

**Security considerations:**
- DEFAULT_ADMIN_ROLE can grant/revoke MINTER_ROLE -- protect admin key
- Consider using a timelock for role changes in production
- Each minter can mint unlimited tokens -- add per-role caps if needed

**Gas optimization:** AccessControl role check adds ~2.6k gas per call.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title MintableRolesERC20
 * @author ChainGPT Pattern Library
 * @notice ERC-20 with role-based access control for minting.
 * @dev Uses AccessControl with MINTER_ROLE.
 *      Admin can grant MINTER_ROLE to staking contracts, bridges, etc.
 */
contract MintableRolesERC20 is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /**
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param initialSupply_ Initial supply in whole tokens
     * @param admin Admin address (receives DEFAULT_ADMIN_ROLE and MINTER_ROLE)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        address admin
    ) ERC20(name_, symbol_) {
        require(admin != address(0), "Zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _mint(admin, initialSupply_ * 10 ** decimals());
    }

    /**
     * @notice Mint tokens. Requires MINTER_ROLE.
     * @param to Recipient
     * @param amount Amount in wei
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }
}
```

---

## 8. Vesting Token

ERC-20 with built-in linear vesting for token allocations.

**When to use:** Token launches where team, advisors, investors receive tokens with vesting schedules.

**Security considerations:**
- Vested tokens are held by the contract, not the beneficiary -- ensures enforcement
- Only owner can create vesting schedules
- Beneficiary can only claim what has vested so far
- Revocable schedules allow owner to claw back unvested tokens (optional)
- Consider using block.timestamp carefully (miners can manipulate +/- 15s)

**Gas optimization:** Each claim iterates zero additional storage. O(1) calculation.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VestingToken
 * @author ChainGPT Pattern Library
 * @notice ERC-20 with built-in linear vesting schedules.
 * @dev Owner creates vesting schedules; beneficiaries claim over time.
 */
contract VestingToken is ERC20, Ownable {
    struct VestingSchedule {
        uint256 totalAmount;
        uint256 startTime;
        uint256 duration;
        uint256 claimed;
        bool revocable;
        bool revoked;
    }

    mapping(address => VestingSchedule) public vestingSchedules;

    event VestingCreated(address indexed beneficiary, uint256 amount, uint256 start, uint256 duration);
    event TokensClaimed(address indexed beneficiary, uint256 amount);
    event VestingRevoked(address indexed beneficiary, uint256 unvestedReturned);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        _mint(msg.sender, initialSupply_ * 10 ** decimals());
    }

    /**
     * @notice Create a vesting schedule for a beneficiary.
     * @param beneficiary Address that will receive vested tokens
     * @param amount Total tokens to vest (in wei)
     * @param startTime Unix timestamp when vesting begins
     * @param duration Duration in seconds over which tokens vest linearly
     * @param revocable Whether the owner can revoke unvested tokens
     */
    function createVesting(
        address beneficiary,
        uint256 amount,
        uint256 startTime,
        uint256 duration,
        bool revocable
    ) external onlyOwner {
        require(beneficiary != address(0), "Zero beneficiary");
        require(amount > 0, "Zero amount");
        require(duration > 0, "Zero duration");
        require(vestingSchedules[beneficiary].totalAmount == 0, "Schedule exists");

        // Transfer tokens from owner to this contract to hold
        _transfer(msg.sender, address(this), amount);

        vestingSchedules[beneficiary] = VestingSchedule({
            totalAmount: amount,
            startTime: startTime,
            duration: duration,
            claimed: 0,
            revocable: revocable,
            revoked: false
        });

        emit VestingCreated(beneficiary, amount, startTime, duration);
    }

    /**
     * @notice Calculate how many tokens have vested for a beneficiary.
     */
    function vestedAmount(address beneficiary) public view returns (uint256) {
        VestingSchedule memory schedule = vestingSchedules[beneficiary];
        if (schedule.revoked) {
            return schedule.claimed;
        }
        if (block.timestamp < schedule.startTime) {
            return 0;
        }
        if (block.timestamp >= schedule.startTime + schedule.duration) {
            return schedule.totalAmount;
        }
        return (schedule.totalAmount * (block.timestamp - schedule.startTime)) / schedule.duration;
    }

    /**
     * @notice Claim vested tokens.
     */
    function claim() external {
        VestingSchedule storage schedule = vestingSchedules[msg.sender];
        require(schedule.totalAmount > 0, "No schedule");

        uint256 vested = vestedAmount(msg.sender);
        uint256 claimable = vested - schedule.claimed;
        require(claimable > 0, "Nothing to claim");

        schedule.claimed += claimable;
        _transfer(address(this), msg.sender, claimable);

        emit TokensClaimed(msg.sender, claimable);
    }

    /**
     * @notice Revoke a vesting schedule (owner only, if revocable).
     */
    function revoke(address beneficiary) external onlyOwner {
        VestingSchedule storage schedule = vestingSchedules[beneficiary];
        require(schedule.revocable, "Not revocable");
        require(!schedule.revoked, "Already revoked");

        uint256 vested = vestedAmount(beneficiary);
        uint256 unvested = schedule.totalAmount - vested;

        schedule.revoked = true;
        if (unvested > 0) {
            _transfer(address(this), msg.sender, unvested);
        }

        emit VestingRevoked(beneficiary, unvested);
    }
}
```

---

## 9. Governance Token

ERC-20 with voting power (ERC20Votes) and gasless approvals (ERC20Permit).

**When to use:** On-chain governance where token holders vote on proposals (works with OpenZeppelin Governor).

**Security considerations:**
- Holders must delegate to themselves (or others) to activate voting power
- Snapshot-based: voting power is recorded at proposal creation block
- Permit allows gasless approvals -- verify deadline and nonce handling
- Clock mode uses block numbers by default (EIP-6372)

**Gas optimization:** ERC20Votes adds ~40k gas per transfer due to checkpoint writes. Consider if all holders need voting or only governance participants.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Nonces.sol";

/**
 * @title GovernanceToken
 * @author ChainGPT Pattern Library
 * @notice ERC-20 with voting and permit for on-chain governance.
 * @dev Compatible with OpenZeppelin Governor contracts.
 *      Holders must call delegate(self) to activate voting power.
 */
contract GovernanceToken is ERC20, ERC20Permit, ERC20Votes, Ownable {
    /**
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param initialSupply_ Supply in whole tokens
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_
    )
        ERC20(name_, symbol_)
        ERC20Permit(name_)
        Ownable(msg.sender)
    {
        _mint(msg.sender, initialSupply_ * 10 ** decimals());
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    // Required overrides

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    function nonces(
        address owner_
    ) public view override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner_);
    }
}
```

---

## 10. Multi-chain Token

ERC-20 designed for cross-chain deployment with bridge mint/burn functions.

**When to use:** Tokens deployed on multiple chains with a canonical bridge that mints/burns.

**Security considerations:**
- BRIDGE_ROLE must be granted only to verified bridge contracts
- Bridge can mint unlimited -- ensure bridge contract itself has limits
- Consider adding per-transaction and daily mint caps for bridge
- Original chain should use lock/unlock; destination chains use mint/burn
- Audit bridge integration thoroughly -- bridges are #1 target for hacks

**Gas optimization:** Standard ERC-20 gas + AccessControl overhead (~2.6k per mint/burn).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title MultiChainToken
 * @author ChainGPT Pattern Library
 * @notice ERC-20 with bridge mint/burn for cross-chain deployment.
 * @dev Bridges are granted BRIDGE_ROLE to mint/burn tokens.
 *      Includes daily mint cap for additional security.
 */
contract MultiChainToken is ERC20, ERC20Burnable, AccessControl, Pausable {
    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public dailyMintCap;
    uint256 public mintedToday;
    uint256 public lastMintReset;

    event BridgeMint(address indexed bridge, address indexed to, uint256 amount);
    event BridgeBurn(address indexed bridge, address indexed from, uint256 amount);
    event DailyMintCapUpdated(uint256 newCap);

    /**
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param initialSupply_ Initial supply (0 for non-canonical chains)
     * @param admin Admin address
     * @param dailyMintCap_ Max tokens mintable per day by bridges (in wei)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        address admin,
        uint256 dailyMintCap_
    ) ERC20(name_, symbol_) {
        require(admin != address(0), "Zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        dailyMintCap = dailyMintCap_;
        lastMintReset = block.timestamp;

        if (initialSupply_ > 0) {
            _mint(admin, initialSupply_ * 10 ** decimals());
        }
    }

    /**
     * @notice Bridge mints tokens on the destination chain.
     * @param to Recipient
     * @param amount Amount in wei
     */
    function bridgeMint(address to, uint256 amount) external onlyRole(BRIDGE_ROLE) whenNotPaused {
        _resetDailyMintIfNeeded();
        require(mintedToday + amount <= dailyMintCap, "Daily mint cap exceeded");
        mintedToday += amount;
        _mint(to, amount);
        emit BridgeMint(msg.sender, to, amount);
    }

    /**
     * @notice Bridge burns tokens before sending to another chain.
     * @param from Token holder (must have approved bridge)
     * @param amount Amount in wei
     */
    function bridgeBurn(address from, uint256 amount) external onlyRole(BRIDGE_ROLE) whenNotPaused {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
        emit BridgeBurn(msg.sender, from, amount);
    }

    function setDailyMintCap(uint256 newCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        dailyMintCap = newCap;
        emit DailyMintCapUpdated(newCap);
    }

    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function _resetDailyMintIfNeeded() private {
        if (block.timestamp >= lastMintReset + 1 days) {
            mintedToday = 0;
            lastMintReset = block.timestamp;
        }
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override whenNotPaused {
        super._update(from, to, value);
    }
}
```

**Constructor parameters:**
| Parameter | Type | Example |
|-----------|------|---------|
| `initialSupply_` | uint256 | `0` on non-canonical chain, `1000000` on origin |
| `dailyMintCap_` | uint256 | `1000000e18` (1M tokens/day bridge limit) |
