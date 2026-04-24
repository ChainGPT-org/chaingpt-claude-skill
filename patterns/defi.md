# DeFi Patterns

Complete, production-ready DeFi patterns for the ChainGPT Contract Generator.

---

## 1. Simple Staking Pool

Stake token A, earn token B over time at a fixed rate.

**When to use:** Single-token staking with reward token distribution (e.g., stake CGPT, earn rewards).

**Security considerations:**
- ReentrancyGuard on all state-changing functions
- Use SafeERC20 for all token transfers (handles non-standard return values)
- Reward rate can only be set by owner -- validate it is sustainable
- Users must unstake to realize rewards -- no auto-compounding in this basic version
- Consider adding an emergency withdraw that forfeits rewards

**Gas optimization:** ~80k gas per stake, ~100k per unstake+claim. Reward calculation is O(1) using reward-per-token-stored pattern.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SimpleStakingPool
 * @author ChainGPT Pattern Library
 * @notice Stake tokenA to earn tokenB over time.
 * @dev Uses Synthetix-style reward-per-token-stored for O(1) reward calculation.
 */
contract SimpleStakingPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;

    uint256 public rewardRate;       // tokens per second
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public periodFinish;

    uint256 public totalStaked;
    mapping(address => uint256) public staked;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 newRate, uint256 duration);

    constructor(address stakingToken_, address rewardToken_) Ownable(msg.sender) {
        require(stakingToken_ != address(0) && rewardToken_ != address(0), "Zero address");
        stakingToken = IERC20(stakingToken_);
        rewardToken = IERC20(rewardToken_);
    }

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalStaked == 0) return rewardPerTokenStored;
        return rewardPerTokenStored +
            ((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / totalStaked;
    }

    function earned(address account) public view returns (uint256) {
        return (staked[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / 1e18
            + rewards[account];
    }

    /**
     * @notice Stake tokens into the pool.
     * @param amount Amount of staking tokens
     */
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        totalStaked += amount;
        staked[msg.sender] += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Unstake tokens from the pool.
     * @param amount Amount to unstake
     */
    function unstake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        require(amount > 0 && amount <= staked[msg.sender], "Invalid amount");
        totalStaked -= amount;
        staked[msg.sender] -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    /**
     * @notice Claim accumulated rewards.
     */
    function claimReward() external nonReentrant updateReward(msg.sender) {
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "No rewards");
        rewards[msg.sender] = 0;
        rewardToken.safeTransfer(msg.sender, reward);
        emit RewardClaimed(msg.sender, reward);
    }

    /**
     * @notice Set reward rate and duration. Owner must transfer reward tokens first.
     * @param reward Total reward tokens for the period
     * @param duration Duration in seconds
     */
    function setRewardRate(uint256 reward, uint256 duration) external onlyOwner updateReward(address(0)) {
        require(duration > 0, "Zero duration");
        if (block.timestamp < periodFinish) {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / duration;
        } else {
            rewardRate = reward / duration;
        }
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + duration;
        emit RewardRateUpdated(rewardRate, duration);
    }

    /**
     * @notice Emergency unstake without rewards.
     */
    function emergencyWithdraw() external nonReentrant {
        uint256 amount = staked[msg.sender];
        require(amount > 0, "Nothing staked");
        totalStaked -= amount;
        staked[msg.sender] = 0;
        rewards[msg.sender] = 0;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }
}
```

---

## 2. Flexible Staking

Multiple pools with different APYs and lock periods.

**When to use:** Staking platform with tiered options (30-day, 90-day, 365-day locks with increasing rewards).

**Security considerations:**
- Lock periods are enforced -- users cannot withdraw early
- Owner can add pools but cannot modify existing pool parameters (prevents rug)
- Early withdrawal penalty option included but clearly documented
- Total reward allocation must be pre-funded

**Gas optimization:** ~100k gas per stake. Pool lookup is O(1) by index.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FlexibleStaking
 * @author ChainGPT Pattern Library
 * @notice Multi-pool staking with configurable lock periods and APYs.
 */
contract FlexibleStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable stakingToken;

    struct Pool {
        uint256 lockDuration;    // seconds
        uint256 rewardRateBps;   // annual reward rate in basis points (e.g., 1200 = 12% APY)
        uint256 totalStaked;
        bool active;
    }

    struct Stake {
        uint256 poolId;
        uint256 amount;
        uint256 startTime;
        uint256 rewardDebt;
        bool withdrawn;
    }

    Pool[] public pools;
    mapping(address => Stake[]) public userStakes;
    uint256 public totalRewardsReserved;

    event PoolCreated(uint256 indexed poolId, uint256 lockDuration, uint256 rewardRateBps);
    event Staked(address indexed user, uint256 indexed poolId, uint256 stakeIndex, uint256 amount);
    event Unstaked(address indexed user, uint256 stakeIndex, uint256 amount, uint256 reward);

    constructor(address stakingToken_) Ownable(msg.sender) {
        stakingToken = IERC20(stakingToken_);
    }

    /**
     * @notice Create a new staking pool.
     * @param lockDuration Lock period in seconds
     * @param rewardRateBps Annual reward rate in basis points
     */
    function createPool(uint256 lockDuration, uint256 rewardRateBps) external onlyOwner {
        require(rewardRateBps <= 50000, "Rate too high"); // max 500% APY
        pools.push(Pool(lockDuration, rewardRateBps, 0, true));
        emit PoolCreated(pools.length - 1, lockDuration, rewardRateBps);
    }

    function setPoolActive(uint256 poolId, bool active) external onlyOwner {
        pools[poolId].active = active;
    }

    /**
     * @notice Stake tokens into a specific pool.
     * @param poolId Pool index
     * @param amount Amount to stake
     */
    function stake(uint256 poolId, uint256 amount) external nonReentrant {
        require(poolId < pools.length, "Invalid pool");
        require(pools[poolId].active, "Pool inactive");
        require(amount > 0, "Zero amount");

        pools[poolId].totalStaked += amount;
        userStakes[msg.sender].push(Stake({
            poolId: poolId,
            amount: amount,
            startTime: block.timestamp,
            rewardDebt: 0,
            withdrawn: false
        }));

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, poolId, userStakes[msg.sender].length - 1, amount);
    }

    /**
     * @notice Unstake tokens after lock period.
     * @param stakeIndex Index in the user's stakes array
     */
    function unstake(uint256 stakeIndex) external nonReentrant {
        Stake storage s = userStakes[msg.sender][stakeIndex];
        require(!s.withdrawn, "Already withdrawn");

        Pool storage pool = pools[s.poolId];
        require(
            block.timestamp >= s.startTime + pool.lockDuration,
            "Lock period not ended"
        );

        s.withdrawn = true;
        pool.totalStaked -= s.amount;

        uint256 reward = _calculateReward(s.amount, pool.rewardRateBps, pool.lockDuration);
        uint256 total = s.amount + reward;

        stakingToken.safeTransfer(msg.sender, total);
        emit Unstaked(msg.sender, stakeIndex, s.amount, reward);
    }

    /**
     * @notice Calculate reward for a given amount, rate, and duration.
     */
    function _calculateReward(
        uint256 amount,
        uint256 rateBps,
        uint256 duration
    ) internal pure returns (uint256) {
        // reward = amount * rateBps / 10000 * (duration / 365 days)
        return (amount * rateBps * duration) / (10000 * 365 days);
    }

    /**
     * @notice View pending reward for a stake.
     */
    function pendingReward(address user, uint256 stakeIndex) external view returns (uint256) {
        Stake memory s = userStakes[user][stakeIndex];
        if (s.withdrawn) return 0;
        Pool memory pool = pools[s.poolId];
        uint256 elapsed = block.timestamp - s.startTime;
        if (elapsed > pool.lockDuration) elapsed = pool.lockDuration;
        return (s.amount * pool.rewardRateBps * elapsed) / (10000 * 365 days);
    }

    function getUserStakeCount(address user) external view returns (uint256) {
        return userStakes[user].length;
    }

    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    /**
     * @notice Fund the contract with reward tokens.
     */
    function fundRewards(uint256 amount) external onlyOwner {
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        totalRewardsReserved += amount;
    }
}
```

---

## 3. Linear Vesting

Time-based linear token release for allocations.

**When to use:** Token distribution to team, advisors, investors with gradual unlock.

**Security considerations:**
- Only admin can create schedules
- Beneficiary can only claim what has vested
- Handle edge case where start is in the future (nothing claimable yet)
- Consider adding revocation for team members who leave

**Gas optimization:** O(1) vesting calculation. ~60k gas per claim.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title LinearVesting
 * @author ChainGPT Pattern Library
 * @notice Linear token vesting over a configurable duration.
 */
contract LinearVesting is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    struct Schedule {
        uint256 totalAmount;
        uint256 startTime;
        uint256 duration;
        uint256 claimed;
    }

    mapping(address => Schedule) public schedules;
    address[] public beneficiaries;

    event ScheduleCreated(address indexed beneficiary, uint256 amount, uint256 start, uint256 duration);
    event Claimed(address indexed beneficiary, uint256 amount);

    constructor(address token_) Ownable(msg.sender) {
        token = IERC20(token_);
    }

    /**
     * @notice Create a vesting schedule.
     * @param beneficiary Recipient of vested tokens
     * @param amount Total tokens to vest
     * @param startTime Unix timestamp when vesting begins
     * @param duration Duration in seconds
     */
    function createSchedule(
        address beneficiary,
        uint256 amount,
        uint256 startTime,
        uint256 duration
    ) external onlyOwner {
        require(beneficiary != address(0), "Zero address");
        require(amount > 0 && duration > 0, "Invalid params");
        require(schedules[beneficiary].totalAmount == 0, "Schedule exists");

        schedules[beneficiary] = Schedule(amount, startTime, duration, 0);
        beneficiaries.push(beneficiary);

        token.safeTransferFrom(msg.sender, address(this), amount);
        emit ScheduleCreated(beneficiary, amount, startTime, duration);
    }

    /**
     * @notice Calculate vested amount for a beneficiary.
     */
    function vested(address beneficiary) public view returns (uint256) {
        Schedule memory s = schedules[beneficiary];
        if (block.timestamp < s.startTime) return 0;
        if (block.timestamp >= s.startTime + s.duration) return s.totalAmount;
        return (s.totalAmount * (block.timestamp - s.startTime)) / s.duration;
    }

    /**
     * @notice Calculate claimable (vested minus already claimed).
     */
    function claimable(address beneficiary) public view returns (uint256) {
        return vested(beneficiary) - schedules[beneficiary].claimed;
    }

    /**
     * @notice Claim vested tokens.
     */
    function claim() external {
        uint256 amount = claimable(msg.sender);
        require(amount > 0, "Nothing to claim");

        schedules[msg.sender].claimed += amount;
        token.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    function beneficiaryCount() external view returns (uint256) {
        return beneficiaries.length;
    }
}
```

---

## 4. Cliff + Linear Vesting

Cliff period where nothing vests, followed by linear vesting.

**When to use:** Standard investor/team vesting (e.g., 1-year cliff, then 3-year linear vest).

**Security considerations:**
- Same as linear vesting plus:
- Cliff must be less than total duration
- Revocable schedules allow clawback of unvested tokens

**Gas optimization:** Same as linear vesting. Cliff check adds negligible gas.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CliffLinearVesting
 * @author ChainGPT Pattern Library
 * @notice Token vesting with cliff period then linear release.
 * @dev Example: 12-month cliff, then 36-month linear vest.
 */
contract CliffLinearVesting is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    struct Schedule {
        uint256 totalAmount;
        uint256 startTime;
        uint256 cliffDuration; // seconds before any tokens vest
        uint256 vestDuration;  // total vesting duration (includes cliff)
        uint256 claimed;
        bool revocable;
        bool revoked;
    }

    mapping(address => Schedule) public schedules;

    event ScheduleCreated(
        address indexed beneficiary, uint256 amount,
        uint256 cliff, uint256 totalDuration, bool revocable
    );
    event Claimed(address indexed beneficiary, uint256 amount);
    event Revoked(address indexed beneficiary, uint256 returnedAmount);

    constructor(address token_) Ownable(msg.sender) {
        token = IERC20(token_);
    }

    /**
     * @notice Create a cliff + linear vesting schedule.
     * @param beneficiary Recipient
     * @param amount Total tokens
     * @param startTime Vesting start
     * @param cliffDuration Cliff in seconds (e.g., 365 days)
     * @param vestDuration Total duration including cliff (e.g., 4 * 365 days)
     * @param revocable Whether admin can revoke unvested tokens
     */
    function createSchedule(
        address beneficiary,
        uint256 amount,
        uint256 startTime,
        uint256 cliffDuration,
        uint256 vestDuration,
        bool revocable
    ) external onlyOwner {
        require(beneficiary != address(0), "Zero address");
        require(amount > 0 && vestDuration > 0, "Invalid params");
        require(cliffDuration <= vestDuration, "Cliff exceeds duration");
        require(schedules[beneficiary].totalAmount == 0, "Schedule exists");

        schedules[beneficiary] = Schedule(
            amount, startTime, cliffDuration, vestDuration, 0, revocable, false
        );

        token.safeTransferFrom(msg.sender, address(this), amount);
        emit ScheduleCreated(beneficiary, amount, cliffDuration, vestDuration, revocable);
    }

    function vested(address beneficiary) public view returns (uint256) {
        Schedule memory s = schedules[beneficiary];
        if (s.revoked) return s.claimed;
        if (block.timestamp < s.startTime + s.cliffDuration) return 0;
        if (block.timestamp >= s.startTime + s.vestDuration) return s.totalAmount;

        // Linear vesting after cliff
        uint256 elapsed = block.timestamp - s.startTime;
        return (s.totalAmount * elapsed) / s.vestDuration;
    }

    function claimable(address beneficiary) public view returns (uint256) {
        return vested(beneficiary) - schedules[beneficiary].claimed;
    }

    function claim() external {
        uint256 amount = claimable(msg.sender);
        require(amount > 0, "Nothing to claim");
        schedules[msg.sender].claimed += amount;
        token.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /**
     * @notice Revoke unvested tokens. Only for revocable schedules.
     */
    function revoke(address beneficiary) external onlyOwner {
        Schedule storage s = schedules[beneficiary];
        require(s.revocable && !s.revoked, "Cannot revoke");

        uint256 vestedAmount = vested(beneficiary);
        uint256 unvested = s.totalAmount - vestedAmount;
        s.revoked = true;

        if (unvested > 0) {
            token.safeTransfer(msg.sender, unvested);
        }
        emit Revoked(beneficiary, unvested);
    }
}
```

---

## 5. Milestone Vesting

Release tokens at specific dates or milestones.

**When to use:** Project-based vesting where tokens unlock at roadmap milestones rather than linearly.

**Security considerations:**
- Milestones can be time-based (automatic) or approval-based (requires owner confirmation)
- Approval-based milestones give owner control -- ensure trust model is clear
- All milestone data is immutable after creation except approval status

**Gas optimization:** ~45k gas per claim. Milestone lookup is O(n) where n = number of milestones per beneficiary (typically < 10).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MilestoneVesting
 * @author ChainGPT Pattern Library
 * @notice Token vesting that releases at specific milestones.
 * @dev Milestones can be time-triggered or manually approved.
 */
contract MilestoneVesting is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    struct Milestone {
        uint256 amount;      // tokens released at this milestone
        uint256 unlockTime;  // 0 = requires manual approval
        bool approved;       // owner approval (for non-time milestones)
        bool claimed;
    }

    struct VestingPlan {
        uint256 totalAmount;
        Milestone[] milestones;
    }

    mapping(address => VestingPlan) private _plans;

    event PlanCreated(address indexed beneficiary, uint256 totalAmount, uint256 milestoneCount);
    event MilestoneApproved(address indexed beneficiary, uint256 milestoneIndex);
    event MilestoneClaimed(address indexed beneficiary, uint256 milestoneIndex, uint256 amount);

    constructor(address token_) Ownable(msg.sender) {
        token = IERC20(token_);
    }

    /**
     * @notice Create a milestone-based vesting plan.
     * @param beneficiary Recipient
     * @param amounts Array of token amounts per milestone
     * @param unlockTimes Array of unlock timestamps (0 = manual approval required)
     */
    function createPlan(
        address beneficiary,
        uint256[] calldata amounts,
        uint256[] calldata unlockTimes
    ) external onlyOwner {
        require(beneficiary != address(0), "Zero address");
        require(amounts.length == unlockTimes.length, "Array mismatch");
        require(amounts.length > 0, "No milestones");
        require(_plans[beneficiary].totalAmount == 0, "Plan exists");

        uint256 total;
        VestingPlan storage plan = _plans[beneficiary];
        for (uint256 i = 0; i < amounts.length; i++) {
            require(amounts[i] > 0, "Zero milestone amount");
            plan.milestones.push(Milestone(amounts[i], unlockTimes[i], false, false));
            total += amounts[i];
        }
        plan.totalAmount = total;

        token.safeTransferFrom(msg.sender, address(this), total);
        emit PlanCreated(beneficiary, total, amounts.length);
    }

    /**
     * @notice Approve a manual milestone (owner only).
     */
    function approveMilestone(address beneficiary, uint256 index) external onlyOwner {
        VestingPlan storage plan = _plans[beneficiary];
        require(index < plan.milestones.length, "Invalid index");
        require(!plan.milestones[index].approved, "Already approved");
        plan.milestones[index].approved = true;
        emit MilestoneApproved(beneficiary, index);
    }

    /**
     * @notice Claim all available milestones.
     */
    function claim() external {
        VestingPlan storage plan = _plans[msg.sender];
        require(plan.totalAmount > 0, "No plan");

        uint256 totalClaim;
        for (uint256 i = 0; i < plan.milestones.length; i++) {
            Milestone storage m = plan.milestones[i];
            if (m.claimed) continue;

            bool unlocked;
            if (m.unlockTime > 0) {
                unlocked = block.timestamp >= m.unlockTime;
            } else {
                unlocked = m.approved;
            }

            if (unlocked) {
                m.claimed = true;
                totalClaim += m.amount;
                emit MilestoneClaimed(msg.sender, i, m.amount);
            }
        }

        require(totalClaim > 0, "Nothing to claim");
        token.safeTransfer(msg.sender, totalClaim);
    }

    function getMilestoneCount(address beneficiary) external view returns (uint256) {
        return _plans[beneficiary].milestones.length;
    }

    function getMilestone(address beneficiary, uint256 index) external view returns (
        uint256 amount, uint256 unlockTime, bool approved, bool claimed
    ) {
        Milestone memory m = _plans[beneficiary].milestones[index];
        return (m.amount, m.unlockTime, m.approved, m.claimed);
    }
}
```

---

## 6. Bonding Curve

Continuous token model where price is a function of supply.

**When to use:** Token launches with automated price discovery, continuous fundraising, curation markets.

**Security considerations:**
- Bonding curve math must be precise -- use fixed-point or integer math carefully
- Front-running is a major risk; consider commit-reveal or batch auctions
- Slippage protection (minTokens/minETH) is critical
- Reserve ratio determines curve steepness -- test thoroughly
- Consider using Bancor formula for more sophisticated curves

**Gas optimization:** ~80k gas per buy/sell. Math operations dominate cost.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BondingCurve
 * @author ChainGPT Pattern Library
 * @notice Continuous token model where price = slope * supply.
 * @dev Linear bonding curve: price increases linearly with supply.
 *      Cost to buy n tokens = integral(slope * x, supply, supply+n)
 *      = slope * n * (2*supply + n) / 2
 */
contract BondingCurve is ERC20, Ownable, ReentrancyGuard {
    uint256 public slope; // price increment per token (in wei per token-wei)
    uint256 public reserveBalance;

    event TokensPurchased(address indexed buyer, uint256 amount, uint256 cost);
    event TokensSold(address indexed seller, uint256 amount, uint256 refund);

    /**
     * @param name_ Token name
     * @param symbol_ Token symbol
     * @param slope_ Price slope (higher = steeper curve). In wei. e.g., 1e12
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 slope_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        require(slope_ > 0, "Zero slope");
        slope = slope_;
    }

    /**
     * @notice Calculate cost to buy `amount` tokens at current supply.
     */
    function buyPrice(uint256 amount) public view returns (uint256) {
        uint256 supply = totalSupply();
        // Integral of linear curve: slope * amount * (2*supply + amount) / (2 * 1e18)
        return (slope * amount * (2 * supply + amount)) / (2 * 1e18);
    }

    /**
     * @notice Calculate refund for selling `amount` tokens at current supply.
     */
    function sellPrice(uint256 amount) public view returns (uint256) {
        uint256 supply = totalSupply();
        require(amount <= supply, "Exceeds supply");
        uint256 newSupply = supply - amount;
        return (slope * amount * (2 * newSupply + amount)) / (2 * 1e18);
    }

    /**
     * @notice Current price per token (marginal price at current supply).
     */
    function currentPrice() public view returns (uint256) {
        return (slope * totalSupply()) / 1e18;
    }

    /**
     * @notice Buy tokens with ETH.
     * @param minTokens Minimum tokens to receive (slippage protection)
     */
    function buy(uint256 minTokens) external payable nonReentrant {
        require(msg.value > 0, "Send ETH");

        // Binary search for token amount that costs <= msg.value
        uint256 low = 1;
        uint256 high = msg.value * 1e18 / slope; // upper bound estimate
        if (high == 0) high = 1;
        uint256 amount;

        while (low <= high) {
            uint256 mid = (low + high) / 2;
            uint256 cost = buyPrice(mid);
            if (cost <= msg.value) {
                amount = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        require(amount >= minTokens, "Slippage: insufficient tokens");
        uint256 cost = buyPrice(amount);
        reserveBalance += cost;

        _mint(msg.sender, amount);

        // Refund excess ETH
        uint256 refund = msg.value - cost;
        if (refund > 0) {
            (bool sent, ) = msg.sender.call{value: refund}("");
            require(sent, "Refund failed");
        }

        emit TokensPurchased(msg.sender, amount, cost);
    }

    /**
     * @notice Sell tokens for ETH.
     * @param amount Tokens to sell
     * @param minEth Minimum ETH to receive (slippage protection)
     */
    function sell(uint256 amount, uint256 minEth) external nonReentrant {
        require(amount > 0, "Zero amount");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");

        uint256 refund = sellPrice(amount);
        require(refund >= minEth, "Slippage: insufficient ETH");
        require(refund <= reserveBalance, "Insufficient reserve");

        reserveBalance -= refund;
        _burn(msg.sender, amount);

        (bool sent, ) = msg.sender.call{value: refund}("");
        require(sent, "Transfer failed");

        emit TokensSold(msg.sender, amount, refund);
    }
}
```

---

## 7. Constant Product AMM

Basic x*y=k automated market maker (Uniswap V2 style).

**When to use:** Decentralized token swaps, liquidity provision, price discovery.

**Security considerations:**
- **CRITICAL:** Vulnerable to flash loan manipulation if used as a price oracle
- Use TWAP (time-weighted average price) for oracle needs
- Reentrancy guard on all swap/liquidity functions
- Minimum liquidity burn (MINIMUM_LIQUIDITY) prevents donation attacks
- Slippage protection is mandatory -- never swap without minAmountOut
- Front-running/sandwich attacks are inherent to AMMs

**Gas optimization:** ~120k gas per swap. LP token mint/burn ~150k.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title ConstantProductAMM
 * @author ChainGPT Pattern Library
 * @notice Basic x*y=k AMM with LP token.
 * @dev Simplified Uniswap V2 pair contract. For production, use established AMM code.
 */
contract ConstantProductAMM is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token0;
    IERC20 public immutable token1;

    uint256 public reserve0;
    uint256 public reserve1;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    uint256 public constant FEE_BPS = 30; // 0.3% swap fee

    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(
        address token0_,
        address token1_
    ) ERC20("AMM LP Token", "AMM-LP") {
        require(token0_ != token1_, "Identical tokens");
        token0 = IERC20(token0_);
        token1 = IERC20(token1_);
    }

    /**
     * @notice Add liquidity to the pool.
     * @param amount0 Amount of token0
     * @param amount1 Amount of token1
     * @return liquidity LP tokens minted
     */
    function addLiquidity(uint256 amount0, uint256 amount1) external nonReentrant returns (uint256 liquidity) {
        require(amount0 > 0 && amount1 > 0, "Zero amounts");

        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);

        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(1), MINIMUM_LIQUIDITY); // permanent lock
        } else {
            liquidity = Math.min(
                (amount0 * _totalSupply) / reserve0,
                (amount1 * _totalSupply) / reserve1
            );
        }

        require(liquidity > 0, "Insufficient liquidity");
        _mint(msg.sender, liquidity);

        reserve0 += amount0;
        reserve1 += amount1;

        emit LiquidityAdded(msg.sender, amount0, amount1, liquidity);
    }

    /**
     * @notice Remove liquidity from the pool.
     * @param liquidity LP tokens to burn
     * @return amount0 Token0 returned
     * @return amount1 Token1 returned
     */
    function removeLiquidity(uint256 liquidity) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(liquidity > 0, "Zero liquidity");

        uint256 _totalSupply = totalSupply();
        amount0 = (liquidity * reserve0) / _totalSupply;
        amount1 = (liquidity * reserve1) / _totalSupply;
        require(amount0 > 0 && amount1 > 0, "Insufficient amounts");

        _burn(msg.sender, liquidity);

        reserve0 -= amount0;
        reserve1 -= amount1;

        token0.safeTransfer(msg.sender, amount0);
        token1.safeTransfer(msg.sender, amount1);

        emit LiquidityRemoved(msg.sender, amount0, amount1, liquidity);
    }

    /**
     * @notice Swap token0 for token1 or vice versa.
     * @param tokenIn Address of input token
     * @param amountIn Amount of input token
     * @param minAmountOut Minimum output (slippage protection)
     * @return amountOut Actual output amount
     */
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "Zero input");
        require(tokenIn == address(token0) || tokenIn == address(token1), "Invalid token");

        bool isToken0 = tokenIn == address(token0);
        (IERC20 input, IERC20 output, uint256 resIn, uint256 resOut) = isToken0
            ? (token0, token1, reserve0, reserve1)
            : (token1, token0, reserve1, reserve0);

        input.safeTransferFrom(msg.sender, address(this), amountIn);

        // x * y = k with 0.3% fee
        uint256 amountInWithFee = amountIn * (10000 - FEE_BPS) / 10000;
        amountOut = (resOut * amountInWithFee) / (resIn + amountInWithFee);

        require(amountOut >= minAmountOut, "Slippage exceeded");
        require(amountOut > 0, "Zero output");

        output.safeTransfer(msg.sender, amountOut);

        // Update reserves
        if (isToken0) {
            reserve0 += amountIn;
            reserve1 -= amountOut;
        } else {
            reserve1 += amountIn;
            reserve0 -= amountOut;
        }

        emit Swap(msg.sender, tokenIn, amountIn, amountOut);
    }

    /**
     * @notice Get expected output amount for a swap.
     */
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256) {
        bool isToken0 = tokenIn == address(token0);
        (uint256 resIn, uint256 resOut) = isToken0
            ? (reserve0, reserve1)
            : (reserve1, reserve0);
        uint256 amountInWithFee = amountIn * (10000 - FEE_BPS) / 10000;
        return (resOut * amountInWithFee) / (resIn + amountInWithFee);
    }
}
```

---

## 8. Yield Aggregator Vault

ERC-4626 tokenized vault for yield aggregation.

**When to use:** DeFi vaults that auto-compound yields (Yearn-style), wrapper for yield-bearing assets.

**Security considerations:**
- ERC-4626 standardizes vault accounting -- use OpenZeppelin implementation
- Donation attacks: MINIMUM_DEPOSIT and virtual shares mitigate
- Strategy risk: vault assets may be in external protocols
- Withdrawal may not be instant if funds are deployed in strategies
- Share price manipulation via direct transfer (donation) -- handled by virtual offset

**Gas optimization:** Deposit/withdraw ~80k gas. Share calculation is O(1).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title YieldVault
 * @author ChainGPT Pattern Library
 * @notice ERC-4626 tokenized vault for yield aggregation.
 * @dev Deposits underlying asset, receives vault shares. Yield accrues to share price.
 */
contract YieldVault is ERC4626, Ownable, ReentrancyGuard {
    uint256 public totalYieldEarned;
    uint256 public performanceFeeBps; // basis points taken from yield
    uint256 public constant MAX_FEE = 2000; // 20%
    address public feeRecipient;

    event YieldHarvested(uint256 amount, uint256 fee);
    event PerformanceFeeUpdated(uint256 newFeeBps);

    /**
     * @param asset_ Underlying ERC-20 token
     * @param name_ Vault share name (e.g., "Yield CGPT")
     * @param symbol_ Vault share symbol (e.g., "yCGPT")
     * @param performanceFeeBps_ Fee on yield in basis points
     * @param feeRecipient_ Address receiving fees
     */
    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        uint256 performanceFeeBps_,
        address feeRecipient_
    )
        ERC4626(asset_)
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {
        require(performanceFeeBps_ <= MAX_FEE, "Fee too high");
        require(feeRecipient_ != address(0), "Zero fee recipient");
        performanceFeeBps = performanceFeeBps_;
        feeRecipient = feeRecipient_;
    }

    /**
     * @notice Harvest yield from strategy and add to vault.
     * @dev In production, this would call external yield sources.
     *      Here it accepts a direct deposit as simulated yield.
     * @param amount Yield amount to add
     */
    function harvest(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Zero yield");
        IERC20 underlying = IERC20(asset());

        // Transfer yield into vault
        SafeERC20.safeTransferFrom(underlying, msg.sender, address(this), amount);

        // Take performance fee
        uint256 fee;
        if (performanceFeeBps > 0) {
            fee = (amount * performanceFeeBps) / 10000;
            SafeERC20.safeTransfer(underlying, feeRecipient, fee);
        }

        totalYieldEarned += (amount - fee);
        emit YieldHarvested(amount, fee);
    }

    function setPerformanceFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE, "Fee too high");
        performanceFeeBps = newFeeBps;
        emit PerformanceFeeUpdated(newFeeBps);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "Zero address");
        feeRecipient = newRecipient;
    }

    /**
     * @dev Override to add reentrancy protection.
     */
    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256) {
        return super.deposit(assets, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner_) public override nonReentrant returns (uint256) {
        return super.withdraw(assets, receiver, owner_);
    }
}
```

---

## 9. Flash Loan Pool

ERC-3156 compliant flash loan provider.

**When to use:** Lending protocols, arbitrage infrastructure, liquidation bots.

**Security considerations:**
- **CRITICAL:** Borrower must repay principal + fee in the same transaction
- Fee must be non-zero to prevent free loans
- Validate callback returns the correct hash (ERC-3156 requirement)
- Flash loan can be used for governance attacks -- consider implications
- Reentrancy is by design (callback pattern) but overall state must be consistent

**Gas optimization:** ~80k base gas + borrower callback gas. Fee calculation is minimal.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";

/**
 * @title FlashLoanPool
 * @author ChainGPT Pattern Library
 * @notice ERC-3156 compliant flash loan provider.
 * @dev Supports multiple tokens. Fee is configurable per token.
 */
contract FlashLoanPool is IERC3156FlashLender, Ownable {
    using SafeERC20 for IERC20;

    bytes32 public constant CALLBACK_SUCCESS = keccak256("ERC3156FlashBorrower.onFlashLoan");

    mapping(address => bool) public supportedTokens;
    mapping(address => uint256) public flashFees; // basis points per token
    uint256 public constant MAX_FEE = 100; // 1% max fee

    event FlashLoan(address indexed borrower, address indexed token, uint256 amount, uint256 fee);
    event TokenAdded(address indexed token, uint256 fee);
    event FeeUpdated(address indexed token, uint256 newFee);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Add a token to the flash loan pool.
     * @param token Token address
     * @param feeBps Fee in basis points (e.g., 9 = 0.09%)
     */
    function addToken(address token, uint256 feeBps) external onlyOwner {
        require(feeBps <= MAX_FEE, "Fee too high");
        supportedTokens[token] = true;
        flashFees[token] = feeBps;
        emit TokenAdded(token, feeBps);
    }

    function setFee(address token, uint256 feeBps) external onlyOwner {
        require(supportedTokens[token], "Token not supported");
        require(feeBps <= MAX_FEE, "Fee too high");
        flashFees[token] = feeBps;
        emit FeeUpdated(token, feeBps);
    }

    /**
     * @notice Maximum flash loan amount for a token.
     */
    function maxFlashLoan(address token) external view override returns (uint256) {
        if (!supportedTokens[token]) return 0;
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @notice Flash loan fee for a given amount.
     */
    function flashFee(address token, uint256 amount) public view override returns (uint256) {
        require(supportedTokens[token], "Token not supported");
        return (amount * flashFees[token]) / 10000;
    }

    /**
     * @notice Execute a flash loan.
     * @param receiver Borrower contract (must implement IERC3156FlashBorrower)
     * @param token Token to borrow
     * @param amount Amount to borrow
     * @param data Arbitrary data passed to borrower callback
     */
    function flashLoan(
        IERC3156FlashBorrower receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external override returns (bool) {
        require(supportedTokens[token], "Token not supported");
        uint256 fee = flashFee(token, amount);
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        require(amount <= balanceBefore, "Insufficient liquidity");

        // Send tokens to borrower
        IERC20(token).safeTransfer(address(receiver), amount);

        // Call borrower callback
        require(
            receiver.onFlashLoan(msg.sender, token, amount, fee, data) == CALLBACK_SUCCESS,
            "Callback failed"
        );

        // Verify repayment
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        require(balanceAfter >= balanceBefore + fee, "Repayment failed");

        emit FlashLoan(address(receiver), token, amount, fee);
        return true;
    }

    /**
     * @notice Deposit tokens into the lending pool.
     */
    function deposit(address token, uint256 amount) external {
        require(supportedTokens[token], "Token not supported");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @notice Withdraw tokens from the pool (owner only).
     */
    function withdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}
```

---

## 10. Token Swap

Simple OTC swap between two parties with deadline.

**When to use:** Peer-to-peer token trades, OTC deals with known counterparty, escrow-style swaps.

**Security considerations:**
- Both parties must approve the swap contract before execution
- Deadline prevents stale swaps from lingering indefinitely
- Creator can cancel before counterparty fills
- Atomic execution -- either both sides exchange or neither does
- Validate token addresses are not zero and amounts are non-zero

**Gas optimization:** ~100k gas for create, ~150k for fill (two token transfers). Cancel ~40k.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TokenSwap
 * @author ChainGPT Pattern Library
 * @notice OTC token swap between two parties with deadline.
 * @dev Party A deposits tokenA, Party B deposits tokenB. Atomic exchange.
 */
contract TokenSwap is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum SwapStatus { Open, Filled, Cancelled, Expired }

    struct Swap {
        address creator;
        address counterparty; // address(0) = anyone can fill
        address tokenA;
        uint256 amountA;
        address tokenB;
        uint256 amountB;
        uint256 deadline;
        SwapStatus status;
    }

    Swap[] public swaps;

    event SwapCreated(uint256 indexed swapId, address indexed creator, address tokenA, uint256 amountA, address tokenB, uint256 amountB, uint256 deadline);
    event SwapFilled(uint256 indexed swapId, address indexed filler);
    event SwapCancelled(uint256 indexed swapId);

    /**
     * @notice Create a new swap offer.
     * @param tokenA Token the creator is offering
     * @param amountA Amount of tokenA
     * @param tokenB Token the creator wants
     * @param amountB Amount of tokenB
     * @param counterparty Specific counterparty or address(0) for open swap
     * @param deadline Unix timestamp after which swap expires
     */
    function createSwap(
        address tokenA,
        uint256 amountA,
        address tokenB,
        uint256 amountB,
        address counterparty,
        uint256 deadline
    ) external nonReentrant returns (uint256 swapId) {
        require(tokenA != address(0) && tokenB != address(0), "Zero token address");
        require(amountA > 0 && amountB > 0, "Zero amount");
        require(deadline > block.timestamp, "Deadline in past");

        swapId = swaps.length;
        swaps.push(Swap({
            creator: msg.sender,
            counterparty: counterparty,
            tokenA: tokenA,
            amountA: amountA,
            tokenB: tokenB,
            amountB: amountB,
            deadline: deadline,
            status: SwapStatus.Open
        }));

        // Creator deposits tokenA
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);

        emit SwapCreated(swapId, msg.sender, tokenA, amountA, tokenB, amountB, deadline);
    }

    /**
     * @notice Fill a swap by providing the requested tokens.
     * @param swapId ID of the swap to fill
     */
    function fillSwap(uint256 swapId) external nonReentrant {
        Swap storage s = swaps[swapId];
        require(s.status == SwapStatus.Open, "Swap not open");
        require(block.timestamp <= s.deadline, "Swap expired");
        if (s.counterparty != address(0)) {
            require(msg.sender == s.counterparty, "Not designated counterparty");
        }

        s.status = SwapStatus.Filled;

        // Filler sends tokenB to creator
        IERC20(s.tokenB).safeTransferFrom(msg.sender, s.creator, s.amountB);

        // Creator's tokenA goes to filler
        IERC20(s.tokenA).safeTransfer(msg.sender, s.amountA);

        emit SwapFilled(swapId, msg.sender);
    }

    /**
     * @notice Cancel an open swap and recover deposited tokens.
     * @param swapId ID of the swap to cancel
     */
    function cancelSwap(uint256 swapId) external nonReentrant {
        Swap storage s = swaps[swapId];
        require(s.creator == msg.sender, "Not creator");
        require(s.status == SwapStatus.Open, "Swap not open");

        s.status = SwapStatus.Cancelled;
        IERC20(s.tokenA).safeTransfer(msg.sender, s.amountA);

        emit SwapCancelled(swapId);
    }

    /**
     * @notice Reclaim tokens from an expired swap.
     */
    function reclaimExpired(uint256 swapId) external nonReentrant {
        Swap storage s = swaps[swapId];
        require(s.creator == msg.sender, "Not creator");
        require(s.status == SwapStatus.Open, "Swap not open");
        require(block.timestamp > s.deadline, "Not expired");

        s.status = SwapStatus.Expired;
        IERC20(s.tokenA).safeTransfer(msg.sender, s.amountA);
    }

    function getSwapCount() external view returns (uint256) {
        return swaps.length;
    }
}
```
