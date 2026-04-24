# React Native Web3 Wallet with AI Assistant Template

Mobile app with in-wallet AI chatbot powered by ChainGPT.

### Project Structure
```
rn-wallet-ai/
├── package.json
├── app.json
├── tsconfig.json
├── .env.example
├── App.tsx (navigation setup)
├── src/
│   ├── screens/
│   │   ├── WalletScreen.tsx (balances + portfolio)
│   │   ├── ChatScreen.tsx (AI assistant)
│   │   └── NFTScreen.tsx (AI NFT generation)
│   ├── services/
│   │   ├── chaingptChat.ts (LLM integration)
│   │   └── chaingptNft.ts (NFT generation)
│   ├── components/
│   │   ├── ChatBubble.tsx
│   │   ├── ChatInput.tsx
│   │   ├── NFTCard.tsx
│   │   └── BalanceCard.tsx
│   └── utils/
│       └── config.ts
└── README.md
```

### Dependencies
react-native, @react-navigation/native, @react-navigation/bottom-tabs, @chaingpt/generalchat, @chaingpt/nft, react-native-dotenv

### Key Implementation
- ChatScreen: ScrollView + FlatList for messages, TextInput for questions, fetch to a backend proxy (SDK is Node-only, not browser/RN)
- Backend proxy needed: Simple Express server wrapping ChainGPT SDK calls (include as /server directory)
- NFTScreen: Text input for prompt, model picker, generate button, image display, mint button
- Context injection with wallet-specific data (connected chain, token holdings)

Note: ChainGPT SDKs are Node.js only — the RN app must call a backend proxy. Include the proxy server in the template.
