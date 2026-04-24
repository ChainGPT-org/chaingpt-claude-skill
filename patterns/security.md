# Security & Utility Patterns

Complete, production-ready security patterns for the ChainGPT Contract Generator.

---

## 1. Role-Based Access Control

Multiple roles with admin hierarchy using OpenZeppelin AccessControl.

**When to use:** Any contract requiring more than simple owner-only access (multiple admins, operators, minters, pausers).

**Security considerations:**
- DEFAULT_ADMIN_ROLE can grant/revoke all other roles -- protect this key
- Consider using a multisig or timelock as DEFAULT_ADMIN_ROLE holder
- Role renunciation is permanent -- cannot be undone
- Each role can have a separate admin role (role admin hierarchy)
- Log all role changes for audit trail

**Gas optimization:** Role check costs ~2.6k gas per call. Role grant/revoke ~50k gas.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";

/**
 * @title RoleBasedAccessControl
 * @author ChainGPT Pattern Library
 * @notice Multi-role access control with enumerable role members.
 * @dev Defines a role hierarchy: ADMIN > OPERATOR > MINTER.
 *      Admin can manage operators, operators can manage minters.
 */
contract RoleBasedAccessControl is AccessControlEnumerable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    event ActionPerformed(address indexed performer, string action);

    /**
     * @param admin Initial admin address
     * @param operators Initial operator addresses
     */
    constructor(address admin, address[] memory operators) {
        require(admin != address(0), "Zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        // Set role admin hierarchy:
        // DEFAULT_ADMIN_ROLE manages OPERATOR_ROLE
        // OPERATOR_ROLE manages MINTER_ROLE
        _setRoleAdmin(OPERATOR_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(MINTER_ROLE, OPERATOR_ROLE);
        _setRoleAdmin(PAUSER_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(UPGRADER_ROLE, DEFAULT_ADMIN_ROLE);

        for (uint256 i = 0; i < operators.length; i++) {
            _grantRole(OPERATOR_ROLE, operators[i]);
        }
    }

    /**
     * @notice Example protected function requiring OPERATOR_ROLE.
     */
    function operatorAction(string memory action) external onlyRole(OPERATOR_ROLE) {
        emit ActionPerformed(msg.sender, action);
    }

    /**
     * @notice Example protected function requiring MINTER_ROLE.
     */
    function minterAction(string memory action) external onlyRole(MINTER_ROLE) {
        emit ActionPerformed(msg.sender, action);
    }

    /**
     * @notice Get all members of a role.
     */
    function getRoleMembers(bytes32 role) external view returns (address[] memory) {
        uint256 count = getRoleMemberCount(role);
        address[] memory members = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            members[i] = getRoleMember(role, i);
        }
        return members;
    }
}
```

---

## 2. Pausable Contract

Emergency pause/unpause by authorized role.

**When to use:** Any contract that needs an emergency stop mechanism (tokens, DeFi protocols, NFT mints).

**Security considerations:**
- Pause should be fast -- do not require multi-sig for pausing (only for unpausing)
- Consider a guardian role separate from admin for pause authority
- Paused state should block all critical operations (transfers, mints, withdrawals)
- Always provide a way to unpause -- avoid permanent lock
- Log all pause/unpause events for incident response

**Gas optimization:** Pause check adds ~2.1k gas per modified function call.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title PausableContract
 * @author ChainGPT Pattern Library
 * @notice Emergency pause pattern with role-based control.
 * @dev PAUSER_ROLE can pause; ADMIN can pause and unpause.
 *      Design: pausing should be fast (single signer), unpausing requires more authority.
 */
contract PausableContract is Pausable, AccessControl {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");

    uint256 public lastPausedAt;
    string public pauseReason;

    event PauseWithReason(address indexed pauser, string reason);
    event Unpaused(address indexed unpauser);

    constructor(address admin, address pauser) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, pauser);
        _grantRole(UNPAUSER_ROLE, admin);
    }

    /**
     * @notice Pause the contract with a reason.
     * @param reason Description of why the contract is paused
     */
    function pause(string memory reason) external onlyRole(PAUSER_ROLE) {
        _pause();
        lastPausedAt = block.timestamp;
        pauseReason = reason;
        emit PauseWithReason(msg.sender, reason);
    }

    /**
     * @notice Unpause the contract.
     */
    function unpause() external onlyRole(UNPAUSER_ROLE) {
        _unpause();
        pauseReason = "";
        emit Unpaused(msg.sender);
    }

    /**
     * @notice Example protected function that requires the contract to not be paused.
     */
    function criticalOperation() external whenNotPaused {
        // Business logic here
    }

    /**
     * @notice Example function that works even when paused (e.g., emergency withdraw).
     */
    function emergencyWithdraw() external {
        // This intentionally does NOT use whenNotPaused
        // Emergency functions should still work when paused
    }
}
```

---

## 3. UUPS Upgradeable

Universal Upgradeable Proxy Standard (UUPS) pattern.

**When to use:** Contracts that need to be upgradeable after deployment (protocol upgrades, bug fixes).

**Security considerations:**
- **CRITICAL:** Never forget to include `_authorizeUpgrade` -- without it, anyone can upgrade
- Storage layout must be preserved between versions (no reordering, no removing, only appending)
- Use storage gaps (`__gap`) for future-proofing in base contracts
- Test upgrade thoroughly on testnet before mainnet
- Consider adding a timelock on upgrades
- Always use `reinitializer(n)` for re-initialization on upgrade

**Gas optimization:** UUPS has ~200 gas overhead per call (delegatecall). Cheaper than transparent proxy which adds admin checks.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/**
 * @title UUPSUpgradeableContract
 * @author ChainGPT Pattern Library
 * @notice UUPS upgradeable contract pattern.
 * @dev Deployment:
 *   1. Deploy implementation contract
 *   2. Deploy ERC1967Proxy pointing to implementation
 *   3. Call initialize() through the proxy
 *
 *   Upgrade:
 *   1. Deploy new implementation
 *   2. Call upgradeToAndCall() through the proxy
 *
 *   Install: npm install @openzeppelin/contracts-upgradeable
 */
contract UUPSUpgradeableContract is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable
{
    // --- Storage (V1) ---
    uint256 public value;
    string public name;

    // Storage gap for future upgrades (reserve 50 slots)
    uint256[48] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract (replaces constructor for proxies).
     * @param owner_ Contract owner
     * @param name_ Contract name
     */
    function initialize(address owner_, string memory name_) public initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        __Pausable_init();
        name = name_;
    }

    /**
     * @notice Set a value. Example business logic.
     */
    function setValue(uint256 newValue) external onlyOwner whenNotPaused {
        value = newValue;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /**
     * @notice Get the current implementation version.
     */
    function version() external pure virtual returns (string memory) {
        return "1.0.0";
    }

    /**
     * @dev Required override. Only owner can authorize upgrades.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}

/**
 * @title UUPSUpgradeableContractV2
 * @notice Example V2 upgrade -- adds a new storage variable.
 * @dev Storage layout: value (slot 0), name (slot 1), newField (slot 2), __gap (slots 3-50)
 */
contract UUPSUpgradeableContractV2 is UUPSUpgradeableContract {
    // New storage variable goes AFTER existing variables, BEFORE __gap
    // Reduce __gap by 1 to maintain total slot count
    uint256 public newField;
    uint256[47] private __gap_v2; // 48 - 1 = 47

    function initializeV2(uint256 newFieldValue) external reinitializer(2) {
        newField = newFieldValue;
    }

    function version() external pure override returns (string memory) {
        return "2.0.0";
    }
}
```

**Proxy deployment helper (for reference):**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @dev Deploy sequence:
 *   address impl = address(new UUPSUpgradeableContract());
 *   bytes memory data = abi.encodeCall(UUPSUpgradeableContract.initialize, (owner, "MyContract"));
 *   address proxy = address(new ERC1967Proxy(impl, data));
 *   // Interact with UUPSUpgradeableContract(proxy)
 */
```

---

## 4. Timelock

Delay execution of sensitive operations.

**When to use:** Admin actions that should have a waiting period (parameter changes, fund movements, role changes).

**Security considerations:**
- Minimum delay prevents instant execution of dangerous actions
- Operations can be cancelled during the waiting period
- Consider different delays for different operation types (higher risk = longer delay)
- Predecessor chain allows dependent operations
- Hash of operation includes all parameters -- prevents tampering

**Gas optimization:** ~100k gas per schedule, ~80k per execute. Storage of operation hashes is O(1).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title CustomTimelock
 * @author ChainGPT Pattern Library
 * @notice Timelock for delaying sensitive operations.
 * @dev Operations are scheduled, wait for delay, then executed.
 */
contract CustomTimelock is AccessControl {
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant CANCELLER_ROLE = keccak256("CANCELLER_ROLE");

    uint256 public minDelay;
    uint256 public constant MAX_DELAY = 30 days;

    enum OperationState { Unset, Pending, Ready, Executed, Cancelled }

    struct Operation {
        address target;
        uint256 value;
        bytes data;
        uint256 readyTimestamp; // when it can be executed
        OperationState state;
    }

    mapping(bytes32 => Operation) public operations;

    event OperationScheduled(bytes32 indexed id, address target, uint256 value, uint256 readyTimestamp);
    event OperationExecuted(bytes32 indexed id);
    event OperationCancelled(bytes32 indexed id);
    event MinDelayUpdated(uint256 newDelay);

    constructor(uint256 minDelay_, address admin) {
        require(minDelay_ <= MAX_DELAY, "Delay too long");
        minDelay = minDelay_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PROPOSER_ROLE, admin);
        _grantRole(EXECUTOR_ROLE, admin);
        _grantRole(CANCELLER_ROLE, admin);
    }

    /**
     * @notice Compute the operation ID from its parameters.
     */
    function hashOperation(
        address target,
        uint256 value,
        bytes memory data,
        bytes32 salt
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(target, value, data, salt));
    }

    /**
     * @notice Schedule an operation for future execution.
     * @param target Contract to call
     * @param value ETH to send
     * @param data Calldata
     * @param salt Unique salt to differentiate identical operations
     * @param delay Delay in seconds (must be >= minDelay)
     */
    function schedule(
        address target,
        uint256 value,
        bytes memory data,
        bytes32 salt,
        uint256 delay
    ) external onlyRole(PROPOSER_ROLE) returns (bytes32 id) {
        require(delay >= minDelay, "Delay too short");
        id = hashOperation(target, value, data, salt);
        require(operations[id].state == OperationState.Unset, "Already scheduled");

        operations[id] = Operation({
            target: target,
            value: value,
            data: data,
            readyTimestamp: block.timestamp + delay,
            state: OperationState.Pending
        });

        emit OperationScheduled(id, target, value, block.timestamp + delay);
    }

    /**
     * @notice Execute a scheduled operation after its delay.
     */
    function execute(bytes32 id) external payable onlyRole(EXECUTOR_ROLE) {
        Operation storage op = operations[id];
        require(op.state == OperationState.Pending, "Not pending");
        require(block.timestamp >= op.readyTimestamp, "Not ready");

        op.state = OperationState.Executed;
        (bool success, ) = op.target.call{value: op.value}(op.data);
        require(success, "Execution failed");

        emit OperationExecuted(id);
    }

    /**
     * @notice Cancel a pending operation.
     */
    function cancel(bytes32 id) external onlyRole(CANCELLER_ROLE) {
        require(operations[id].state == OperationState.Pending, "Not pending");
        operations[id].state = OperationState.Cancelled;
        emit OperationCancelled(id);
    }

    function setMinDelay(uint256 newDelay) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newDelay <= MAX_DELAY, "Delay too long");
        minDelay = newDelay;
        emit MinDelayUpdated(newDelay);
    }

    function getOperationState(bytes32 id) external view returns (OperationState) {
        Operation memory op = operations[id];
        if (op.state == OperationState.Pending && block.timestamp >= op.readyTimestamp) {
            return OperationState.Ready;
        }
        return op.state;
    }

    receive() external payable {}
}
```

---

## 5. Rate Limiter

Limit function calls per time period per address.

**When to use:** Prevent abuse of public functions (faucets, free mints, API-like endpoints).

**Security considerations:**
- Rate limits are per-address -- attackers can use multiple addresses
- Consider also adding contract-wide rate limits for global protection
- Time window resets fully (not sliding) -- simpler but less precise
- Set limits conservatively; increase later if needed

**Gas optimization:** ~5k gas overhead per rate-limited call. Storage: 2 slots per (address, function) pair.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RateLimiter
 * @author ChainGPT Pattern Library
 * @notice Per-address function call rate limiting.
 * @dev Tracks calls per time window per address. Reverts if limit exceeded.
 */
contract RateLimiter is Ownable {
    struct RateLimit {
        uint256 maxCalls;       // max calls per window
        uint256 windowDuration; // window size in seconds
    }

    struct UserActivity {
        uint256 callCount;
        uint256 windowStart;
    }

    // functionSelector => RateLimit config
    mapping(bytes4 => RateLimit) public rateLimits;
    // functionSelector => user => UserActivity
    mapping(bytes4 => mapping(address => UserActivity)) private _activity;

    // Global rate limit
    uint256 public globalMaxCallsPerWindow;
    uint256 public globalWindowDuration;
    mapping(address => UserActivity) private _globalActivity;

    event RateLimitSet(bytes4 indexed selector, uint256 maxCalls, uint256 windowDuration);
    event RateLimitExceeded(address indexed user, bytes4 indexed selector);

    constructor(
        uint256 globalMaxCalls,
        uint256 globalWindow
    ) Ownable(msg.sender) {
        globalMaxCallsPerWindow = globalMaxCalls;
        globalWindowDuration = globalWindow;
    }

    /**
     * @notice Check and update rate limit for a function call.
     * @dev Call this at the start of rate-limited functions.
     */
    modifier rateLimited() {
        _checkGlobalLimit(msg.sender);
        _checkFunctionLimit(msg.sig, msg.sender);
        _;
    }

    /**
     * @notice Set rate limit for a specific function.
     * @param selector Function selector (e.g., bytes4(keccak256("mint(address,uint256)")))
     * @param maxCalls Maximum calls per window
     * @param windowDuration Window duration in seconds
     */
    function setRateLimit(
        bytes4 selector,
        uint256 maxCalls,
        uint256 windowDuration
    ) external onlyOwner {
        require(maxCalls > 0 && windowDuration > 0, "Invalid params");
        rateLimits[selector] = RateLimit(maxCalls, windowDuration);
        emit RateLimitSet(selector, maxCalls, windowDuration);
    }

    function setGlobalLimit(uint256 maxCalls, uint256 window) external onlyOwner {
        globalMaxCallsPerWindow = maxCalls;
        globalWindowDuration = window;
    }

    function _checkGlobalLimit(address user) private {
        if (globalMaxCallsPerWindow == 0) return;

        UserActivity storage activity = _globalActivity[user];
        if (block.timestamp >= activity.windowStart + globalWindowDuration) {
            activity.callCount = 0;
            activity.windowStart = block.timestamp;
        }
        activity.callCount++;
        require(activity.callCount <= globalMaxCallsPerWindow, "Global rate limit exceeded");
    }

    function _checkFunctionLimit(bytes4 selector, address user) private {
        RateLimit memory limit = rateLimits[selector];
        if (limit.maxCalls == 0) return; // no limit set for this function

        UserActivity storage activity = _activity[selector][user];
        if (block.timestamp >= activity.windowStart + limit.windowDuration) {
            activity.callCount = 0;
            activity.windowStart = block.timestamp;
        }
        activity.callCount++;
        require(activity.callCount <= limit.maxCalls, "Function rate limit exceeded");
    }

    /**
     * @notice Get remaining calls for a user on a function.
     */
    function remainingCalls(bytes4 selector, address user) external view returns (uint256) {
        RateLimit memory limit = rateLimits[selector];
        if (limit.maxCalls == 0) return type(uint256).max;

        UserActivity memory activity = _activity[selector][user];
        if (block.timestamp >= activity.windowStart + limit.windowDuration) {
            return limit.maxCalls;
        }
        if (activity.callCount >= limit.maxCalls) return 0;
        return limit.maxCalls - activity.callCount;
    }

    // Example rate-limited function
    function exampleFunction() external rateLimited {
        // Protected logic
    }
}
```

---

## 6. Escrow

Conditional release of funds with an arbiter.

**When to use:** Peer-to-peer trades, freelance payments, milestone-based payments, dispute resolution.

**Security considerations:**
- Arbiter is a trusted third party -- choose carefully
- Funds are locked until release or refund
- Arbiter can only release or refund, not take funds (no self-enrichment)
- Consider adding a deadline after which buyer can self-refund
- Multiple partial releases supported for milestone-based work

**Gas optimization:** ~80k gas per deposit. ~60k per release/refund.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Escrow
 * @author ChainGPT Pattern Library
 * @notice Conditional fund release with buyer, seller, and arbiter.
 * @dev Supports both ETH and ERC-20 tokens.
 */
contract Escrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum EscrowState { Created, Funded, Delivered, Completed, Disputed, Refunded }

    struct EscrowDeal {
        address buyer;
        address seller;
        address arbiter;
        address token;       // address(0) for ETH
        uint256 amount;
        uint256 deadline;
        EscrowState state;
        string description;
    }

    EscrowDeal[] public deals;
    uint256 public arbiterFeeBps; // basis points (e.g., 100 = 1%)

    event DealCreated(uint256 indexed dealId, address buyer, address seller, uint256 amount);
    event DealFunded(uint256 indexed dealId);
    event DeliveryConfirmed(uint256 indexed dealId);
    event FundsReleased(uint256 indexed dealId, uint256 amount);
    event FundsRefunded(uint256 indexed dealId, uint256 amount);
    event DisputeRaised(uint256 indexed dealId, address raisedBy);

    constructor(uint256 arbiterFeeBps_) {
        require(arbiterFeeBps_ <= 500, "Fee too high"); // max 5%
        arbiterFeeBps = arbiterFeeBps_;
    }

    /**
     * @notice Create a new escrow deal.
     */
    function createDeal(
        address seller,
        address arbiter,
        address token,
        uint256 amount,
        uint256 deadline,
        string memory description
    ) external payable nonReentrant returns (uint256 dealId) {
        require(seller != address(0) && arbiter != address(0), "Zero address");
        require(amount > 0, "Zero amount");
        require(deadline > block.timestamp, "Past deadline");

        dealId = deals.length;
        deals.push(EscrowDeal({
            buyer: msg.sender,
            seller: seller,
            arbiter: arbiter,
            token: token,
            amount: amount,
            deadline: deadline,
            state: EscrowState.Created,
            description: description
        }));

        // Fund immediately if ETH
        if (token == address(0)) {
            require(msg.value == amount, "Wrong ETH amount");
            deals[dealId].state = EscrowState.Funded;
            emit DealFunded(dealId);
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            deals[dealId].state = EscrowState.Funded;
            emit DealFunded(dealId);
        }

        emit DealCreated(dealId, msg.sender, seller, amount);
    }

    /**
     * @notice Buyer confirms delivery, releasing funds to seller.
     */
    function confirmDelivery(uint256 dealId) external nonReentrant {
        EscrowDeal storage deal = deals[dealId];
        require(msg.sender == deal.buyer, "Not buyer");
        require(deal.state == EscrowState.Funded || deal.state == EscrowState.Delivered, "Invalid state");

        deal.state = EscrowState.Completed;
        _releaseFunds(deal);
        emit FundsReleased(dealId, deal.amount);
    }

    /**
     * @notice Raise a dispute (buyer or seller).
     */
    function raiseDispute(uint256 dealId) external {
        EscrowDeal storage deal = deals[dealId];
        require(
            msg.sender == deal.buyer || msg.sender == deal.seller,
            "Not party to deal"
        );
        require(deal.state == EscrowState.Funded, "Invalid state");
        deal.state = EscrowState.Disputed;
        emit DisputeRaised(dealId, msg.sender);
    }

    /**
     * @notice Arbiter resolves dispute by releasing to seller.
     */
    function resolveRelease(uint256 dealId) external nonReentrant {
        EscrowDeal storage deal = deals[dealId];
        require(msg.sender == deal.arbiter, "Not arbiter");
        require(deal.state == EscrowState.Disputed, "Not disputed");

        deal.state = EscrowState.Completed;
        _releaseFunds(deal);
        emit FundsReleased(dealId, deal.amount);
    }

    /**
     * @notice Arbiter resolves dispute by refunding buyer.
     */
    function resolveRefund(uint256 dealId) external nonReentrant {
        EscrowDeal storage deal = deals[dealId];
        require(msg.sender == deal.arbiter, "Not arbiter");
        require(deal.state == EscrowState.Disputed, "Not disputed");

        deal.state = EscrowState.Refunded;
        _refundBuyer(deal);
        emit FundsRefunded(dealId, deal.amount);
    }

    /**
     * @notice Buyer self-refund after deadline passes (if not completed).
     */
    function deadlineRefund(uint256 dealId) external nonReentrant {
        EscrowDeal storage deal = deals[dealId];
        require(msg.sender == deal.buyer, "Not buyer");
        require(block.timestamp > deal.deadline, "Deadline not passed");
        require(deal.state == EscrowState.Funded, "Invalid state");

        deal.state = EscrowState.Refunded;
        _refundBuyer(deal);
        emit FundsRefunded(dealId, deal.amount);
    }

    function _releaseFunds(EscrowDeal storage deal) private {
        uint256 fee = (deal.amount * arbiterFeeBps) / 10000;
        uint256 sellerAmount = deal.amount - fee;

        if (deal.token == address(0)) {
            (bool s1, ) = deal.seller.call{value: sellerAmount}("");
            require(s1, "Seller payment failed");
            if (fee > 0) {
                (bool s2, ) = deal.arbiter.call{value: fee}("");
                require(s2, "Arbiter fee failed");
            }
        } else {
            IERC20(deal.token).safeTransfer(deal.seller, sellerAmount);
            if (fee > 0) {
                IERC20(deal.token).safeTransfer(deal.arbiter, fee);
            }
        }
    }

    function _refundBuyer(EscrowDeal storage deal) private {
        if (deal.token == address(0)) {
            (bool success, ) = deal.buyer.call{value: deal.amount}("");
            require(success, "Refund failed");
        } else {
            IERC20(deal.token).safeTransfer(deal.buyer, deal.amount);
        }
    }

    function dealCount() external view returns (uint256) {
        return deals.length;
    }
}
```

---

## 7. Pull Payment

Withdrawal pattern to avoid push payment reentrancy.

**When to use:** Any contract that owes payments to multiple parties (auction winners, reward recipients, refunds).

**Security considerations:**
- Pull pattern eliminates reentrancy risk from ETH sends
- Failed withdrawals do not block other operations
- Track balances accurately -- avoid double-withdrawal
- Consider adding withdrawal deadlines for unclaimed funds
- This is the recommended pattern over push (send/transfer) for security

**Gas optimization:** Deposit tracking ~20k gas. Withdrawal ~35k gas.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PullPayment
 * @author ChainGPT Pattern Library
 * @notice Pull payment pattern -- payees withdraw their own funds.
 * @dev Eliminates reentrancy risk from external calls in critical paths.
 */
contract PullPayment is Ownable, ReentrancyGuard {
    mapping(address => uint256) private _payments;
    uint256 public totalPending;

    event PaymentDeposited(address indexed payee, uint256 amount);
    event PaymentWithdrawn(address indexed payee, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Record a payment owed to an address.
     * @dev Called internally when funds are owed (e.g., after an auction).
     * @param payee Address to receive payment
     */
    function _asyncTransfer(address payee, uint256 amount) internal {
        require(payee != address(0), "Zero payee");
        _payments[payee] += amount;
        totalPending += amount;
        emit PaymentDeposited(payee, amount);
    }

    /**
     * @notice Check payment owed to an address.
     */
    function payments(address payee) public view returns (uint256) {
        return _payments[payee];
    }

    /**
     * @notice Withdraw all pending payments.
     */
    function withdrawPayments() external nonReentrant {
        uint256 amount = _payments[msg.sender];
        require(amount > 0, "No payments");

        _payments[msg.sender] = 0;
        totalPending -= amount;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Withdrawal failed");

        emit PaymentWithdrawn(msg.sender, amount);
    }

    /**
     * @notice Example: auction settlement using pull pattern.
     */
    function settleAuction(address winner, address previousBidder, uint256 previousBid) external onlyOwner {
        // Refund previous bidder via pull payment (safe)
        if (previousBidder != address(0) && previousBid > 0) {
            _asyncTransfer(previousBidder, previousBid);
        }
        // Winner logic...
    }

    receive() external payable {}
}
```

---

## 8. Reentrancy Guard

ReentrancyGuard usage with checks-effects-interactions pattern.

**When to use:** Any function that makes external calls (ETH transfers, token transfers, contract callbacks).

**Security considerations:**
- **ALWAYS** follow Checks-Effects-Interactions (CEI) pattern
- Add ReentrancyGuard as defense-in-depth even with CEI
- Cross-function reentrancy: guard state shared between functions
- Read-only reentrancy: be careful with view functions that read state mid-transaction
- External calls include: .call(), .transfer(), .send(), ERC-20 transfers to contracts with hooks (ERC-777)

**Gas optimization:** ReentrancyGuard costs ~5.2k gas (2 SSTORE operations: locked -> locked). OpenZeppelin uses `1` and `2` instead of `0` and `1` to save gas on the cold-to-warm transition.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ReentrancyGuardExample
 * @author ChainGPT Pattern Library
 * @notice Demonstrates reentrancy protection with CEI pattern.
 * @dev Shows both the pattern (CEI) and the guard (ReentrancyGuard).
 */
contract ReentrancyGuardExample is ReentrancyGuard {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public balances;
    mapping(address => uint256) public tokenBalances;
    IERC20 public token;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    constructor(address token_) {
        token = IERC20(token_);
    }

    /**
     * @notice Deposit ETH.
     */
    function deposit() external payable {
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @notice VULNERABLE withdrawal (DO NOT USE -- for educational purposes).
     * @dev This is the classic reentrancy vulnerability:
     *      1. External call before state update
     *      2. Attacker's receive() calls withdraw() again
     *      3. Balance not yet updated, so re-entrant call succeeds
     */
    // function withdrawUNSAFE(uint256 amount) external {
    //     require(balances[msg.sender] >= amount, "Insufficient");
    //     (bool success, ) = msg.sender.call{value: amount}(""); // EXTERNAL CALL FIRST = BAD
    //     require(success);
    //     balances[msg.sender] -= amount; // STATE UPDATE AFTER = VULNERABLE
    // }

    /**
     * @notice SAFE withdrawal using Checks-Effects-Interactions + ReentrancyGuard.
     * @dev Pattern:
     *   1. CHECKS: Validate all conditions
     *   2. EFFECTS: Update all state
     *   3. INTERACTIONS: Make external calls
     */
    function withdraw(uint256 amount) external nonReentrant {
        // 1. CHECKS
        require(balances[msg.sender] >= amount, "Insufficient balance");

        // 2. EFFECTS (state changes BEFORE external call)
        balances[msg.sender] -= amount;

        // 3. INTERACTIONS (external call LAST)
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Safe token withdrawal demonstrating CEI with ERC-20.
     * @dev ERC-20 transfers can trigger callbacks (ERC-777 hooks).
     *      SafeERC20 handles return value, but reentrancy is still possible.
     */
    function withdrawTokens(uint256 amount) external nonReentrant {
        // CHECKS
        require(tokenBalances[msg.sender] >= amount, "Insufficient");

        // EFFECTS
        tokenBalances[msg.sender] -= amount;

        // INTERACTIONS
        token.safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Example of cross-function reentrancy protection.
     * @dev Both functions share `balances` state and are both nonReentrant.
     */
    function transferBalance(address to, uint256 amount) external nonReentrant {
        require(balances[msg.sender] >= amount, "Insufficient");
        balances[msg.sender] -= amount;
        balances[to] += amount;
    }
}
```

---

## 9. Signature Verification

EIP-712 typed data signing and on-chain verification.

**When to use:** Off-chain authorization (meta-transactions, permit, vouchers, order signing, gasless approvals).

**Security considerations:**
- Use EIP-712 structured data (not raw keccak256) to prevent cross-contract replay
- Include chain ID and contract address in domain separator (automatic with OZ EIP712)
- Include nonce to prevent replay of the same signature
- Include deadline/expiry to prevent stale signatures
- Verify signer has the expected role/permission
- ecrecover returns address(0) for invalid signatures -- always check

**Gas optimization:** ~3k gas for ecrecover. ~1.5k for struct hash computation. Total ~8k for full EIP-712 verify.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SignatureVerifier
 * @author ChainGPT Pattern Library
 * @notice EIP-712 typed data signing and on-chain verification.
 * @dev Example: verifying off-chain signed orders/approvals.
 */
contract SignatureVerifier is EIP712, Ownable {
    using ECDSA for bytes32;

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address token,uint256 amount,uint256 price,uint256 nonce,uint256 deadline)"
    );

    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public usedOrderHashes;

    // Authorized signers
    mapping(address => bool) public authorizedSigners;

    event OrderExecuted(bytes32 indexed orderHash, address indexed maker, uint256 amount, uint256 price);
    event SignerUpdated(address indexed signer, bool authorized);

    struct Order {
        address maker;
        address token;
        uint256 amount;
        uint256 price;
        uint256 nonce;
        uint256 deadline;
        bytes signature;
    }

    constructor() EIP712("SignatureVerifier", "1") Ownable(msg.sender) {
        authorizedSigners[msg.sender] = true;
    }

    function setAuthorizedSigner(address signer, bool authorized) external onlyOwner {
        authorizedSigners[signer] = authorized;
        emit SignerUpdated(signer, authorized);
    }

    /**
     * @notice Verify and execute a signed order.
     * @param order The signed order struct
     */
    function executeOrder(Order calldata order) external {
        require(block.timestamp <= order.deadline, "Order expired");
        require(order.nonce == nonces[order.maker], "Invalid nonce");

        // Compute struct hash
        bytes32 structHash = keccak256(abi.encode(
            ORDER_TYPEHASH,
            order.maker,
            order.token,
            order.amount,
            order.price,
            order.nonce,
            order.deadline
        ));

        // Compute EIP-712 digest
        bytes32 digest = _hashTypedDataV4(structHash);

        // Recover signer
        address signer = ECDSA.recover(digest, order.signature);
        require(signer == order.maker, "Invalid signature");

        // Prevent replay
        bytes32 orderHash = keccak256(order.signature);
        require(!usedOrderHashes[orderHash], "Order already used");
        usedOrderHashes[orderHash] = true;
        nonces[order.maker]++;

        // Execute order logic here...
        emit OrderExecuted(orderHash, order.maker, order.amount, order.price);
    }

    /**
     * @notice Verify a general-purpose signed message.
     * @param signer Expected signer address
     * @param messageHash Hash of the message data
     * @param signature ECDSA signature
     * @return True if signature is valid
     */
    function verifySignature(
        address signer,
        bytes32 messageHash,
        bytes memory signature
    ) public view returns (bool) {
        bytes32 digest = _hashTypedDataV4(messageHash);
        address recovered = ECDSA.recover(digest, signature);
        return recovered == signer;
    }

    /**
     * @notice Get the current nonce for an address.
     */
    function getNonce(address account) external view returns (uint256) {
        return nonces[account];
    }

    /**
     * @notice Get the domain separator (useful for off-chain signing).
     */
    function getDomainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
```

**Off-chain signing example (ethers.js):**

```javascript
// Sign an order off-chain using ethers.js v6
const domain = {
  name: "SignatureVerifier",
  version: "1",
  chainId: 1, // or appropriate chain
  verifyingContract: "0x..." // deployed contract address
};

const types = {
  Order: [
    { name: "maker", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "price", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
};

const order = {
  maker: signer.address,
  token: tokenAddress,
  amount: ethers.parseEther("100"),
  price: ethers.parseEther("1"),
  nonce: 0,
  deadline: Math.floor(Date.now() / 1000) + 3600 // 1 hour
};

const signature = await signer.signTypedData(domain, types, order);
```

---

## 10. Permit (ERC-2612)

Gasless approvals via off-chain signatures.

**When to use:** DApps that want to combine approve + action in one transaction. Users sign an approval off-chain, and the contract uses it to transfer tokens.

**Security considerations:**
- Permit signature includes nonce, deadline, and domain separator -- replay-safe
- Always check deadline before processing permit
- Permit can be front-run: design contract so front-running the permit does not cause harm
- Token must implement ERC-2612 (ERC20Permit) -- not all tokens support this
- Use try/catch when calling permit on unknown tokens

**Gas optimization:** Saves one transaction (~46k gas for approve). Permit verification costs ~3k gas.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PermitExample
 * @author ChainGPT Pattern Library
 * @notice Demonstrates ERC-2612 Permit for gasless approvals.
 * @dev Users sign an approval off-chain; contract calls permit() + transferFrom() in one tx.
 */
contract PermitExample is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    mapping(address => uint256) public deposits;

    event DepositWithPermit(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    constructor(address token_) {
        token = IERC20(token_);
    }

    /**
     * @notice Deposit tokens using ERC-2612 permit (gasless approval).
     * @dev User signs permit off-chain, passes signature components.
     *      Single transaction: permit + deposit (saves ~46k gas vs separate approve tx).
     *
     * @param amount Amount to deposit
     * @param deadline Permit deadline timestamp
     * @param v Signature component v
     * @param r Signature component r
     * @param s Signature component s
     */
    function depositWithPermit(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        require(amount > 0, "Zero amount");

        // Execute permit (sets allowance)
        // Use try/catch in case permit was already used or front-run
        try IERC20Permit(address(token)).permit(
            msg.sender,
            address(this),
            amount,
            deadline,
            v, r, s
        ) {} catch {
            // Permit may have been front-run or already submitted.
            // Fall through if allowance is already sufficient.
            require(
                token.allowance(msg.sender, address(this)) >= amount,
                "Permit failed and insufficient allowance"
            );
        }

        // Transfer tokens (uses the allowance set by permit)
        token.safeTransferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;

        emit DepositWithPermit(msg.sender, amount);
    }

    /**
     * @notice Standard deposit (requires prior approve transaction).
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        token.safeTransferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
    }

    /**
     * @notice Withdraw deposited tokens.
     */
    function withdraw(uint256 amount) external nonReentrant {
        require(deposits[msg.sender] >= amount, "Insufficient deposit");
        deposits[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }
}
```

**Off-chain permit signing (ethers.js):**

```javascript
// Generate permit signature off-chain using ethers.js v6
const domain = {
  name: await token.name(),
  version: "1",
  chainId: (await ethers.provider.getNetwork()).chainId,
  verifyingContract: await token.getAddress()
};

const types = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
};

const nonce = await token.nonces(signer.address);
const deadline = Math.floor(Date.now() / 1000) + 3600;

const permitData = {
  owner: signer.address,
  spender: contractAddress,
  value: ethers.parseEther("100"),
  nonce: nonce,
  deadline: deadline
};

const signature = await signer.signTypedData(domain, types, permitData);
const { v, r, s } = ethers.Signature.from(signature);

// Send to contract
await contract.depositWithPermit(
  ethers.parseEther("100"),
  deadline,
  v, r, s
);
```
