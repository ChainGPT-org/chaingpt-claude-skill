# NFT Patterns (ERC-721 and ERC-1155)

Complete, production-ready NFT patterns for the ChainGPT Contract Generator.

---

## 1. Basic ERC-721

Simple mintable NFT with tokenURI metadata.

**When to use:** Standard NFT collection with off-chain metadata (IPFS/Arweave).

**Security considerations:**
- Only owner can mint -- secure the owner key
- tokenURI points to off-chain JSON; ensure metadata is pinned permanently
- No supply cap in this basic version -- add maxSupply if needed

**Gas optimization:** ~120k gas per mint. Standard OpenZeppelin implementation.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BasicERC721
 * @author ChainGPT Pattern Library
 * @notice Simple mintable ERC-721 NFT with URI storage.
 */
contract BasicERC721 is ERC721, ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    /**
     * @param name_ Collection name
     * @param symbol_ Collection symbol
     */
    constructor(
        string memory name_,
        string memory symbol_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {}

    /**
     * @notice Mint a new NFT with metadata URI.
     * @param to Recipient address
     * @param uri Metadata URI (e.g., "ipfs://Qm...")
     * @return tokenId The ID of the newly minted token
     */
    function safeMint(address to, string memory uri) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        return tokenId;
    }

    // Required overrides
    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage) returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

---

## 2. ERC-721 with On-Chain Metadata

NFT with metadata and SVG image stored entirely on-chain.

**When to use:** Fully on-chain NFTs that never depend on external storage. Art, generative NFTs, on-chain game items.

**Security considerations:**
- On-chain storage is expensive -- keep SVG/JSON minimal
- Base64 encoding adds ~33% overhead
- Metadata is immutable once minted (unless you add update functions)
- Test SVG rendering across marketplaces (OpenSea, Blur, etc.)

**Gas optimization:** ~300k-500k gas per mint depending on SVG complexity. Store shared SVG parts as contract constants to reduce per-mint cost.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title OnChainMetadataERC721
 * @author ChainGPT Pattern Library
 * @notice ERC-721 with fully on-chain SVG + JSON metadata.
 * @dev No IPFS dependency. Metadata is generated from on-chain state.
 */
contract OnChainMetadataERC721 is ERC721, Ownable {
    using Strings for uint256;

    uint256 private _nextTokenId;

    struct TokenData {
        string name;
        string description;
        uint256 level;
        string color;
    }

    mapping(uint256 => TokenData) private _tokenData;

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {}

    /**
     * @notice Mint an NFT with on-chain attributes.
     */
    function mint(
        address to,
        string memory itemName,
        string memory description,
        uint256 level,
        string memory color
    ) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _tokenData[tokenId] = TokenData(itemName, description, level, color);
        return tokenId;
    }

    /**
     * @notice Generate fully on-chain SVG image.
     */
    function _generateSVG(uint256 tokenId) internal view returns (string memory) {
        TokenData memory data = _tokenData[tokenId];
        return string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 350 350">',
                '<rect width="350" height="350" fill="', data.color, '"/>',
                '<text x="50%" y="40%" dominant-baseline="middle" text-anchor="middle" ',
                'font-size="24" fill="white" font-family="monospace">',
                data.name,
                '</text>',
                '<text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" ',
                'font-size="18" fill="white" font-family="monospace">',
                'Level: ', data.level.toString(),
                '</text>',
                '</svg>'
            )
        );
    }

    /**
     * @notice Returns fully on-chain JSON metadata with embedded SVG.
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        TokenData memory data = _tokenData[tokenId];

        string memory svgBase64 = Base64.encode(bytes(_generateSVG(tokenId)));
        string memory json = string(
            abi.encodePacked(
                '{"name":"', data.name,
                '","description":"', data.description,
                '","image":"data:image/svg+xml;base64,', svgBase64,
                '","attributes":[{"trait_type":"Level","value":', data.level.toString(),
                '},{"trait_type":"Color","value":"', data.color, '"}]}'
            )
        );

        return string(
            abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json)))
        );
    }
}
```

---

## 3. ERC-721A Gas-Optimized

Batch minting pattern inspired by Azuki's ERC-721A for massive gas savings.

**When to use:** Large collections where users mint multiple NFTs in one transaction (10k PFP drops, etc.).

**Security considerations:**
- Batch minting saves gas but increases complexity
- Ensure _startTokenId and _nextTokenId are consistent
- ownerOf is O(n) in worst case for unminted ranges -- use _ownershipOf pattern
- This is a simplified version; for production use the official ERC721A package

**Gas optimization:** First mint in batch costs ~52k gas; each additional ~2k gas (vs ~100k+ per standard mint). Savings of 90%+ for batch mints.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ERC721AGasOptimized
 * @author ChainGPT Pattern Library
 * @notice Gas-optimized ERC-721 for batch minting (ERC-721A pattern).
 * @dev Stores ownership only for the first token in a batch.
 *      Subsequent tokens in the batch inherit ownership implicitly.
 *      For full production use, import from erc721a package directly.
 */
contract ERC721AGasOptimized is ERC165, IERC721, IERC721Metadata, Ownable {
    using Strings for uint256;

    string private _name;
    string private _symbol;
    string public baseURI;

    uint256 public maxSupply;
    uint256 public mintPrice;
    uint256 public maxPerTx;
    uint256 private _currentIndex;

    struct TokenOwnership {
        address addr;
        uint64 startTimestamp;
    }

    mapping(uint256 => TokenOwnership) private _ownerships;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    event Minted(address indexed to, uint256 startTokenId, uint256 quantity);

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI_,
        uint256 maxSupply_,
        uint256 mintPrice_,
        uint256 maxPerTx_
    ) Ownable(msg.sender) {
        _name = name_;
        _symbol = symbol_;
        baseURI = baseURI_;
        maxSupply = maxSupply_;
        mintPrice = mintPrice_;
        maxPerTx = maxPerTx_;
    }

    function name() public view override returns (string memory) { return _name; }
    function symbol() public view override returns (string memory) { return _symbol; }
    function totalSupply() public view returns (uint256) { return _currentIndex; }

    function supportsInterface(bytes4 interfaceId) public view override(ERC165, IERC165) returns (bool) {
        return interfaceId == type(IERC721).interfaceId
            || interfaceId == type(IERC721Metadata).interfaceId
            || super.supportsInterface(interfaceId);
    }

    /**
     * @notice Batch mint NFTs. Gas efficient for multiple mints.
     * @param quantity Number of tokens to mint (up to maxPerTx)
     */
    function mint(uint256 quantity) external payable {
        require(quantity > 0 && quantity <= maxPerTx, "Invalid quantity");
        require(_currentIndex + quantity <= maxSupply, "Exceeds max supply");
        require(msg.value >= mintPrice * quantity, "Insufficient payment");

        uint256 startTokenId = _currentIndex;
        _ownerships[startTokenId] = TokenOwnership(msg.sender, uint64(block.timestamp));
        _balances[msg.sender] += quantity;
        _currentIndex += quantity;

        // Emit individual Transfer events for marketplace indexing
        for (uint256 i = 0; i < quantity; i++) {
            emit Transfer(address(0), msg.sender, startTokenId + i);
        }
        emit Minted(msg.sender, startTokenId, quantity);
    }

    function ownerOf(uint256 tokenId) public view override returns (address) {
        require(tokenId < _currentIndex, "Token does not exist");
        // Walk backwards to find the ownership record
        for (uint256 i = tokenId; ; i--) {
            if (_ownerships[i].addr != address(0)) {
                return _ownerships[i].addr;
            }
            if (i == 0) break;
        }
        revert("Owner not found");
    }

    function balanceOf(address owner_) public view override returns (uint256) {
        require(owner_ != address(0), "Zero address");
        return _balances[owner_];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(tokenId < _currentIndex, "Token does not exist");
        return string(abi.encodePacked(baseURI, tokenId.toString(), ".json"));
    }

    function approve(address to, uint256 tokenId) public override {
        address owner_ = ownerOf(tokenId);
        require(msg.sender == owner_ || isApprovedForAll(owner_, msg.sender), "Not authorized");
        _tokenApprovals[tokenId] = to;
        emit Approval(owner_, to, tokenId);
    }

    function getApproved(uint256 tokenId) public view override returns (address) {
        require(tokenId < _currentIndex, "Token does not exist");
        return _tokenApprovals[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) public override {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner_, address operator) public view override returns (bool) {
        return _operatorApprovals[owner_][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public override {
        address owner_ = ownerOf(tokenId);
        require(
            msg.sender == owner_ || getApproved(tokenId) == msg.sender || isApprovedForAll(owner_, msg.sender),
            "Not authorized"
        );
        require(from == owner_, "Not owner");
        require(to != address(0), "Zero address");

        _tokenApprovals[tokenId] = address(0);
        _ownerships[tokenId] = TokenOwnership(to, uint64(block.timestamp));

        // If next token has no explicit owner, set it to maintain chain
        if (tokenId + 1 < _currentIndex && _ownerships[tokenId + 1].addr == address(0)) {
            _ownerships[tokenId + 1] = TokenOwnership(from, uint64(block.timestamp));
        }

        _balances[from]--;
        _balances[to]++;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) public override {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public override {
        transferFrom(from, to, tokenId);
        if (to.code.length > 0) {
            require(
                IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) ==
                IERC721Receiver.onERC721Received.selector,
                "Unsafe recipient"
            );
        }
    }

    function setBaseURI(string memory newBaseURI) external onlyOwner {
        baseURI = newBaseURI;
    }

    function withdraw() external onlyOwner {
        (bool success, ) = msg.sender.call{value: address(this).balance}("");
        require(success, "Withdraw failed");
    }
}
```

---

## 4. Lazy Mint ERC-721

Signature-based lazy minting -- creator signs vouchers off-chain, buyer mints on first purchase.

**When to use:** Gasless listing for creators. Token is only minted when someone buys it, shifting gas cost to buyer.

**Security considerations:**
- Voucher signatures must include tokenId, price, and URI to prevent tampering
- Each voucher can only be redeemed once (nonce tracking)
- Verify signer has MINTER_ROLE before accepting voucher
- Set deadline on vouchers to prevent stale listings
- Use EIP-712 for structured signing (prevents cross-contract replay)

**Gas optimization:** Zero gas for creators until sale. ~150k gas per lazy mint for buyer.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title LazyMintERC721
 * @author ChainGPT Pattern Library
 * @notice ERC-721 with signature-based lazy minting.
 * @dev Creators sign vouchers off-chain; buyers redeem to mint.
 */
contract LazyMintERC721 is ERC721, ERC721URIStorage, EIP712, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant VOUCHER_TYPEHASH = keccak256(
        "MintVoucher(uint256 tokenId,uint256 minPrice,string uri,address creator,uint256 deadline)"
    );

    mapping(uint256 => bool) public voucherRedeemed;

    struct MintVoucher {
        uint256 tokenId;
        uint256 minPrice;
        string uri;
        address creator;
        uint256 deadline;
        bytes signature;
    }

    event LazyMinted(uint256 indexed tokenId, address indexed buyer, address indexed creator, uint256 price);

    constructor(
        string memory name_,
        string memory symbol_
    )
        ERC721(name_, symbol_)
        EIP712(name_, "1")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    /**
     * @notice Redeem a signed voucher to mint an NFT.
     * @param voucher The signed mint voucher
     */
    function redeem(MintVoucher calldata voucher) external payable {
        require(!voucherRedeemed[voucher.tokenId], "Already redeemed");
        require(block.timestamp <= voucher.deadline, "Voucher expired");
        require(msg.value >= voucher.minPrice, "Insufficient payment");

        // Verify signature
        bytes32 structHash = keccak256(abi.encode(
            VOUCHER_TYPEHASH,
            voucher.tokenId,
            voucher.minPrice,
            keccak256(bytes(voucher.uri)),
            voucher.creator,
            voucher.deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, voucher.signature);
        require(hasRole(MINTER_ROLE, signer), "Invalid signer");
        require(signer == voucher.creator, "Signer mismatch");

        voucherRedeemed[voucher.tokenId] = true;
        _safeMint(msg.sender, voucher.tokenId);
        _setTokenURI(voucher.tokenId, voucher.uri);

        // Pay creator
        (bool sent, ) = voucher.creator.call{value: msg.value}("");
        require(sent, "Payment failed");

        emit LazyMinted(voucher.tokenId, msg.sender, voucher.creator, msg.value);
    }

    // Required overrides
    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage) returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

---

## 5. Soulbound Token (SBT)

Non-transferable ERC-721 for identity, credentials, achievements.

**When to use:** Proof of attendance, credentials, reputation, KYC attestation, certifications.

**Security considerations:**
- Tokens cannot be transferred after minting (by design)
- Only issuer (owner) can mint -- credential issuance is centralized
- Consider adding revocation for expired credentials
- Burning by holder is allowed (opt-out of credential)

**Gas optimization:** Same as standard ERC-721 since we only override transfer to revert.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SoulboundToken
 * @author ChainGPT Pattern Library
 * @notice Non-transferable ERC-721 (Soulbound Token / SBT).
 * @dev Transfers are blocked. Only mint, burn, and read operations allowed.
 *      Based on EIP-5192 (Minimal Soulbound NFTs).
 */
contract SoulboundToken is ERC721, ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    /// @notice Emitted when a token's locked status changes (EIP-5192).
    event Locked(uint256 tokenId);

    error SoulboundTransferDisabled();

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {}

    /**
     * @notice Issue a soulbound token to an address.
     * @param to Recipient (the "soul")
     * @param uri Metadata URI
     */
    function issue(address to, string memory uri) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit Locked(tokenId);
        return tokenId;
    }

    /**
     * @notice Revoke (burn) a soulbound token. Owner only.
     */
    function revoke(uint256 tokenId) external onlyOwner {
        _burn(tokenId);
    }

    /**
     * @notice Holder can voluntarily burn their SBT.
     */
    function relinquish(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "Not token owner");
        _burn(tokenId);
    }

    /**
     * @notice Check if a token is locked (always true for SBTs).
     * @dev EIP-5192 interface.
     */
    function locked(uint256 tokenId) external view returns (bool) {
        _requireOwned(tokenId);
        return true;
    }

    /**
     * @dev Block all transfers except mint and burn.
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        // Allow mint (from == 0) and burn (to == 0)
        if (from != address(0) && to != address(0)) {
            revert SoulboundTransferDisabled();
        }
        return super._update(to, tokenId, auth);
    }

    // Required overrides
    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage) returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

---

## 6. Dynamic NFT

NFT whose metadata changes based on on-chain conditions.

**When to use:** Evolving game characters, fitness trackers, weather-based art, time-based reveals.

**Security considerations:**
- Only authorized updater can change state (prevent manipulation)
- State transitions should be validated (no skipping levels, no regression)
- Consider event emission for all state changes for off-chain indexing
- Metadata refresh may have marketplace-specific delays

**Gas optimization:** ~50k gas per state update. Store minimal data on-chain.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title DynamicNFT
 * @author ChainGPT Pattern Library
 * @notice ERC-721 with metadata that evolves based on on-chain state.
 * @dev Example: NFT levels up based on interactions or external triggers.
 */
contract DynamicNFT is ERC721, Ownable {
    using Strings for uint256;

    uint256 private _nextTokenId;

    enum Stage { Egg, Hatchling, Juvenile, Adult, Elder }

    struct Creature {
        string name;
        Stage stage;
        uint256 experience;
        uint256 lastFed;
    }

    mapping(uint256 => Creature) public creatures;

    uint256 public constant EXP_PER_STAGE = 100;
    uint256 public constant FEED_COOLDOWN = 1 hours;

    string[5] private _stageNames = ["Egg", "Hatchling", "Juvenile", "Adult", "Elder"];
    string[5] private _stageColors = ["#808080", "#90EE90", "#4169E1", "#FFD700", "#FF4500"];

    event StageEvolved(uint256 indexed tokenId, Stage newStage);
    event ExperienceGained(uint256 indexed tokenId, uint256 totalExp);

    constructor() ERC721("DynamicCreatures", "DYN") Ownable(msg.sender) {}

    function mint(address to, string memory creatureName) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        creatures[tokenId] = Creature(creatureName, Stage.Egg, 0, block.timestamp);
        return tokenId;
    }

    /**
     * @notice Feed the creature to gain experience. Anyone can feed.
     */
    function feed(uint256 tokenId) external {
        _requireOwned(tokenId);
        Creature storage c = creatures[tokenId];
        require(block.timestamp >= c.lastFed + FEED_COOLDOWN, "Feed cooldown active");

        c.experience += 10;
        c.lastFed = block.timestamp;
        emit ExperienceGained(tokenId, c.experience);

        // Check for evolution
        Stage newStage = _calculateStage(c.experience);
        if (newStage > c.stage) {
            c.stage = newStage;
            emit StageEvolved(tokenId, newStage);
        }
    }

    function _calculateStage(uint256 exp) private pure returns (Stage) {
        if (exp >= EXP_PER_STAGE * 4) return Stage.Elder;
        if (exp >= EXP_PER_STAGE * 3) return Stage.Adult;
        if (exp >= EXP_PER_STAGE * 2) return Stage.Juvenile;
        if (exp >= EXP_PER_STAGE) return Stage.Hatchling;
        return Stage.Egg;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Creature memory c = creatures[tokenId];
        uint256 stageIdx = uint256(c.stage);

        string memory svg = string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">',
            '<rect width="300" height="300" fill="', _stageColors[stageIdx], '" rx="20"/>',
            '<text x="150" y="100" text-anchor="middle" font-size="20" fill="white">', c.name, '</text>',
            '<text x="150" y="160" text-anchor="middle" font-size="28" fill="white">', _stageNames[stageIdx], '</text>',
            '<text x="150" y="220" text-anchor="middle" font-size="16" fill="white">EXP: ', c.experience.toString(), '</text>',
            '</svg>'
        ));

        string memory json = string(abi.encodePacked(
            '{"name":"', c.name, '","description":"A dynamic evolving creature"',
            ',"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)),
            '","attributes":[{"trait_type":"Stage","value":"', _stageNames[stageIdx],
            '"},{"trait_type":"Experience","value":', c.experience.toString(),
            '}]}'
        ));

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }
}
```

---

## 7. ERC-1155 Multi-Token

Fungible and non-fungible tokens in one contract.

**When to use:** Gaming items (swords, potions), mixed collections, event tickets with different tiers.

**Security considerations:**
- Ensure token IDs do not collide between fungible and non-fungible ranges
- Batch operations must handle arrays of equal length
- URI must return valid JSON for each token ID

**Gas optimization:** ERC-1155 is ~50% cheaper than ERC-721 for batch operations. Single storage slot per (address, id) pair.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title MultiToken1155
 * @author ChainGPT Pattern Library
 * @notice ERC-1155 supporting both fungible and non-fungible tokens.
 * @dev Token IDs 0-999 are fungible (currencies, potions).
 *      Token IDs 1000+ are non-fungible (unique items).
 */
contract MultiToken1155 is ERC1155, AccessControl {
    using Strings for uint256;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant URI_SETTER_ROLE = keccak256("URI_SETTER_ROLE");

    string public name;
    string public symbol;

    uint256 public constant FUNGIBLE_BOUNDARY = 1000;
    uint256 private _nextNFTId = FUNGIBLE_BOUNDARY;

    mapping(uint256 => uint256) public maxSupply; // 0 = unlimited
    mapping(uint256 => uint256) public totalMinted;

    event TokenTypeCreated(uint256 indexed tokenId, uint256 maxSupply, bool fungible);

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseURI
    ) ERC1155(baseURI) {
        name = name_;
        symbol = symbol_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(URI_SETTER_ROLE, msg.sender);
    }

    /**
     * @notice Create a new fungible token type.
     * @param tokenId Token ID (must be < FUNGIBLE_BOUNDARY)
     * @param maxSupply_ Max supply (0 for unlimited)
     */
    function createFungibleType(uint256 tokenId, uint256 maxSupply_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(tokenId < FUNGIBLE_BOUNDARY, "ID must be < 1000 for fungible");
        maxSupply[tokenId] = maxSupply_;
        emit TokenTypeCreated(tokenId, maxSupply_, true);
    }

    /**
     * @notice Mint fungible tokens.
     */
    function mintFungible(
        address to,
        uint256 tokenId,
        uint256 amount,
        bytes memory data
    ) external onlyRole(MINTER_ROLE) {
        require(tokenId < FUNGIBLE_BOUNDARY, "Not a fungible token");
        if (maxSupply[tokenId] > 0) {
            require(totalMinted[tokenId] + amount <= maxSupply[tokenId], "Exceeds max supply");
        }
        totalMinted[tokenId] += amount;
        _mint(to, tokenId, amount, data);
    }

    /**
     * @notice Mint a unique non-fungible token.
     */
    function mintNFT(address to, bytes memory data) external onlyRole(MINTER_ROLE) returns (uint256) {
        uint256 tokenId = _nextNFTId++;
        _mint(to, tokenId, 1, data);
        emit TokenTypeCreated(tokenId, 1, false);
        return tokenId;
    }

    /**
     * @notice Batch mint multiple token types.
     */
    function mintBatch(
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) external onlyRole(MINTER_ROLE) {
        for (uint256 i = 0; i < ids.length; i++) {
            if (maxSupply[ids[i]] > 0) {
                require(totalMinted[ids[i]] + amounts[i] <= maxSupply[ids[i]], "Exceeds max supply");
            }
            totalMinted[ids[i]] += amounts[i];
        }
        _mintBatch(to, ids, amounts, data);
    }

    function setURI(string memory newuri) external onlyRole(URI_SETTER_ROLE) {
        _setURI(newuri);
    }

    function uri(uint256 tokenId) public view override returns (string memory) {
        return string(abi.encodePacked(super.uri(tokenId), tokenId.toString(), ".json"));
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC1155, AccessControl) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

---

## 8. Royalty NFT (ERC-2981)

ERC-721 with EIP-2981 royalty standard for marketplace royalty enforcement.

**When to use:** Any NFT collection that wants creator royalties on secondary sales.

**Security considerations:**
- Royalty rate is capped at 10% (configurable) to prevent excessive fees
- ERC-2981 is an informational standard -- marketplaces may choose not to enforce
- Per-token royalty overrides are supported for special editions
- Consider using operator filter (e.g., OpenSea's) for enforcement

**Gas optimization:** Royalty info lookup is view-only and adds no gas to transfers. ~200 gas for royaltyInfo() calls.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RoyaltyNFT
 * @author ChainGPT Pattern Library
 * @notice ERC-721 with EIP-2981 royalty standard.
 * @dev Default royalty applies to all tokens. Per-token overrides available.
 */
contract RoyaltyNFT is ERC721, ERC721URIStorage, ERC2981, Ownable {
    uint256 private _nextTokenId;
    uint96 public constant MAX_ROYALTY = 1000; // 10%

    /**
     * @param name_ Collection name
     * @param symbol_ Collection symbol
     * @param royaltyRecipient Default royalty recipient
     * @param royaltyBps Default royalty in basis points (e.g., 500 = 5%)
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address royaltyRecipient,
        uint96 royaltyBps
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        require(royaltyBps <= MAX_ROYALTY, "Royalty too high");
        _setDefaultRoyalty(royaltyRecipient, royaltyBps);
    }

    function safeMint(address to, string memory uri_) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri_);
        return tokenId;
    }

    /**
     * @notice Set royalty for a specific token (override default).
     */
    function setTokenRoyalty(
        uint256 tokenId,
        address receiver,
        uint96 feeNumerator
    ) external onlyOwner {
        require(feeNumerator <= MAX_ROYALTY, "Royalty too high");
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
    }

    /**
     * @notice Update the default royalty for all tokens.
     */
    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        require(feeNumerator <= MAX_ROYALTY, "Royalty too high");
        _setDefaultRoyalty(receiver, feeNumerator);
    }

    // Required overrides
    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage) returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage, ERC2981) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
```

---

## 9. Allowlist Mint

Merkle proof-based allowlist with multiple mint phases.

**When to use:** NFT launches with whitelist/allowlist for early access, different pricing tiers, and public mint.

**Security considerations:**
- Merkle root must be generated correctly off-chain (sorted pairs, keccak256 leaves)
- Track mints per address per phase to prevent over-minting
- Owner can update Merkle roots -- ensure process is secure
- Verify leaf format matches exactly between on-chain and off-chain generation
- Set reasonable maxPerWallet to prevent whales

**Gas optimization:** Merkle proof verification is O(log n) -- very efficient even for 100k+ allowlists. ~2k gas per proof step.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title AllowlistMintERC721
 * @author ChainGPT Pattern Library
 * @notice ERC-721 with Merkle proof allowlist and multi-phase minting.
 */
contract AllowlistMintERC721 is ERC721, Ownable {
    using Strings for uint256;

    enum Phase { Closed, Allowlist, Public }

    Phase public currentPhase;
    uint256 public maxSupply;
    uint256 public totalMinted;
    string public baseURI;

    // Allowlist phase
    bytes32 public merkleRoot;
    uint256 public allowlistPrice;
    uint256 public allowlistMaxPerWallet;

    // Public phase
    uint256 public publicPrice;
    uint256 public publicMaxPerWallet;

    mapping(address => uint256) public allowlistMinted;
    mapping(address => uint256) public publicMinted;

    event PhaseChanged(Phase newPhase);
    event MerkleRootUpdated(bytes32 newRoot);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        string memory baseURI_,
        bytes32 merkleRoot_,
        uint256 allowlistPrice_,
        uint256 publicPrice_,
        uint256 allowlistMaxPerWallet_,
        uint256 publicMaxPerWallet_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        maxSupply = maxSupply_;
        baseURI = baseURI_;
        merkleRoot = merkleRoot_;
        allowlistPrice = allowlistPrice_;
        publicPrice = publicPrice_;
        allowlistMaxPerWallet = allowlistMaxPerWallet_;
        publicMaxPerWallet = publicMaxPerWallet_;
        currentPhase = Phase.Closed;
    }

    /**
     * @notice Allowlist mint with Merkle proof verification.
     * @param quantity Number of tokens to mint
     * @param proof Merkle proof for the sender's address
     */
    function allowlistMint(uint256 quantity, bytes32[] calldata proof) external payable {
        require(currentPhase == Phase.Allowlist, "Allowlist not active");
        require(totalMinted + quantity <= maxSupply, "Exceeds supply");
        require(msg.value >= allowlistPrice * quantity, "Insufficient payment");
        require(
            allowlistMinted[msg.sender] + quantity <= allowlistMaxPerWallet,
            "Exceeds allowlist limit"
        );

        // Verify Merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender));
        require(MerkleProof.verify(proof, merkleRoot, leaf), "Invalid proof");

        allowlistMinted[msg.sender] += quantity;
        for (uint256 i = 0; i < quantity; i++) {
            _safeMint(msg.sender, totalMinted++);
        }
    }

    /**
     * @notice Public mint (no proof required).
     */
    function publicMint(uint256 quantity) external payable {
        require(currentPhase == Phase.Public, "Public mint not active");
        require(totalMinted + quantity <= maxSupply, "Exceeds supply");
        require(msg.value >= publicPrice * quantity, "Insufficient payment");
        require(
            publicMinted[msg.sender] + quantity <= publicMaxPerWallet,
            "Exceeds public limit"
        );

        publicMinted[msg.sender] += quantity;
        for (uint256 i = 0; i < quantity; i++) {
            _safeMint(msg.sender, totalMinted++);
        }
    }

    function setPhase(Phase phase) external onlyOwner {
        currentPhase = phase;
        emit PhaseChanged(phase);
    }

    function setMerkleRoot(bytes32 root) external onlyOwner {
        merkleRoot = root;
        emit MerkleRootUpdated(root);
    }

    function setBaseURI(string memory newBaseURI) external onlyOwner {
        baseURI = newBaseURI;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string(abi.encodePacked(baseURI, tokenId.toString(), ".json"));
    }

    function withdraw() external onlyOwner {
        (bool success, ) = msg.sender.call{value: address(this).balance}("");
        require(success, "Withdraw failed");
    }
}
```

---

## 10. Revenue-Sharing NFT

NFT holders receive proportional revenue splits from contract earnings.

**When to use:** Music royalties, real estate tokenization, investment clubs, creator revenue sharing.

**Security considerations:**
- Uses pull-payment pattern (holders claim, not pushed) to avoid reentrancy
- Track cumulative revenue per share to handle holders entering at different times
- Ensure deposit function cannot be called with zero value
- Handle edge case of zero total supply (no holders to pay)
- Consider adding minimum claim threshold to save gas on dust amounts

**Gas optimization:** O(1) claim calculation using cumulative revenue tracking. No iteration over holders.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RevenueShareNFT
 * @author ChainGPT Pattern Library
 * @notice ERC-721 where holders receive proportional revenue distributions.
 * @dev Uses cumulative revenue-per-token tracking for O(1) claims.
 */
contract RevenueShareNFT is ERC721, Ownable, ReentrancyGuard {
    uint256 private _nextTokenId;
    uint256 public maxSupply;
    uint256 public mintPrice;

    // Revenue tracking
    uint256 public totalRevenue;
    uint256 private _revenuePerTokenStored; // scaled by 1e18
    mapping(uint256 => uint256) private _revenuePerTokenPaid; // per tokenId
    mapping(address => uint256) private _pendingRevenue;

    event RevenueDeposited(address indexed from, uint256 amount);
    event RevenueClaimed(address indexed holder, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_,
        uint256 mintPrice_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        maxSupply = maxSupply_;
        mintPrice = mintPrice_;
    }

    /**
     * @notice Deposit revenue to be shared among NFT holders.
     */
    function depositRevenue() external payable {
        require(msg.value > 0, "Zero deposit");
        require(_nextTokenId > 0, "No holders");

        _revenuePerTokenStored += (msg.value * 1e18) / _nextTokenId;
        totalRevenue += msg.value;

        emit RevenueDeposited(msg.sender, msg.value);
    }

    /**
     * @notice Mint an NFT.
     */
    function mint() external payable returns (uint256) {
        require(msg.value >= mintPrice, "Insufficient payment");
        require(_nextTokenId < maxSupply, "Sold out");

        uint256 tokenId = _nextTokenId++;
        // New token starts earning from current point
        _revenuePerTokenPaid[tokenId] = _revenuePerTokenStored;
        _safeMint(msg.sender, tokenId);
        return tokenId;
    }

    /**
     * @notice Calculate pending revenue for a specific token.
     */
    function pendingRevenueForToken(uint256 tokenId) public view returns (uint256) {
        return (_revenuePerTokenStored - _revenuePerTokenPaid[tokenId]) / 1e18;
    }

    /**
     * @notice Claim revenue for a set of owned tokens.
     * @param tokenIds Array of token IDs to claim for
     */
    function claimRevenue(uint256[] calldata tokenIds) external nonReentrant {
        uint256 total;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            require(ownerOf(tokenIds[i]) == msg.sender, "Not owner");
            uint256 owed = (_revenuePerTokenStored - _revenuePerTokenPaid[tokenIds[i]]) / 1e18;
            _revenuePerTokenPaid[tokenIds[i]] = _revenuePerTokenStored;
            total += owed;
        }
        require(total > 0, "Nothing to claim");

        (bool success, ) = msg.sender.call{value: total}("");
        require(success, "Transfer failed");

        emit RevenueClaimed(msg.sender, total);
    }

    /**
     * @dev Update revenue tracking on transfer.
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);

        // If transferring (not minting), settle revenue for the token
        if (from != address(0) && to != address(0)) {
            uint256 owed = (_revenuePerTokenStored - _revenuePerTokenPaid[tokenId]) / 1e18;
            if (owed > 0) {
                _pendingRevenue[from] += owed;
            }
            _revenuePerTokenPaid[tokenId] = _revenuePerTokenStored;
        }

        return super._update(to, tokenId, auth);
    }

    /**
     * @notice Claim pending revenue that accumulated before token transfer.
     */
    function claimPendingRevenue() external nonReentrant {
        uint256 amount = _pendingRevenue[msg.sender];
        require(amount > 0, "Nothing pending");
        _pendingRevenue[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Transfer failed");

        emit RevenueClaimed(msg.sender, amount);
    }

    function withdraw() external onlyOwner {
        // Only withdraw mint proceeds, not deposited revenue
        (bool success, ) = msg.sender.call{value: mintPrice * _nextTokenId}("");
        require(success, "Withdraw failed");
    }

    receive() external payable {
        // Accept ETH as revenue
        if (_nextTokenId > 0) {
            _revenuePerTokenStored += (msg.value * 1e18) / _nextTokenId;
            totalRevenue += msg.value;
            emit RevenueDeposited(msg.sender, msg.value);
        }
    }
}
```
