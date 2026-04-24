# Solidity LLM — ChainGPT Open-Source Code Generation Model

## Model Specifications

| Property | Value |
|----------|-------|
| Developer | ChainGPT |
| License | MIT |
| Base Model | Salesforce/codegen-2B-multi |
| Type | Causal Language Model (Code Generation) |
| Tokenizer | GPT2Tokenizer |
| Parameters | 2 Billion |
| Transformer Layers | 32 |
| Context Length | 2,048 tokens |
| Data Type | bfloat16 |
| HuggingFace | https://huggingface.co/Chain-GPT/Solidity-LLM |
| Demo | https://huggingface.co/spaces/Chain-GPT/ChainGPT-Solidity-LLM |

## Performance Benchmarks

| Metric | Solidity LLM | GPT-4.5 | GPT-4o mini | Qwen 2.5-Coder-7B | DeepSeek-Coder-7B |
|--------|:------------:|:-------:|:-----------:|:------------------:|:-----------------:|
| Compilation Success | **83%** | 50% | 30% | 20% | 15% |
| OpenZeppelin Compliance | 65% | **75%** | 70% | 50% | 40% |
| Gas Efficiency | **72%** | 68% | 70% | 60% | 55% |
| Security Posture | 58% | **70%** | 65% | 55% | 50% |
| Line-of-Code Efficiency | **70%** | 68% | 69% | 60% | 58% |

## Installation & Usage

```python
pip install transformers==4.51.3 torch==2.7.0 accelerate==1.6.0
```

```python
from transformers import AutoModelForCausalLM, AutoTokenizer

model = AutoModelForCausalLM.from_pretrained("Chain-GPT/Solidity-LLM").to("cuda")
tokenizer = AutoTokenizer.from_pretrained("Chain-GPT/Solidity-LLM")

prompt = "Write a Solidity function to transfer tokens."
inputs = tokenizer(prompt, return_tensors="pt").to("cuda")
outputs = model.generate(
    **inputs,
    max_new_tokens=1400,
    pad_token_id=tokenizer.eos_token_id
)
print(tokenizer.decode(outputs[0], skip_special_tokens=True))
```

## Streaming Usage

```python
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer
from threading import Thread

model = AutoModelForCausalLM.from_pretrained("Chain-GPT/Solidity-LLM").to("cuda")
tokenizer = AutoTokenizer.from_pretrained("Chain-GPT/Solidity-LLM")

prompt = "Write a Solidity ERC-20 token contract."
inputs = tokenizer(prompt, return_tensors="pt").to("cuda")

streamer = TextIteratorStreamer(tokenizer, skip_special_tokens=True)

generation_kwargs = dict(
    **inputs,
    max_new_tokens=1400,
    temperature=0.7,
    do_sample=True,
    pad_token_id=tokenizer.eos_token_id,
    streamer=streamer
)

thread = Thread(target=model.generate, kwargs=generation_kwargs)
thread.start()

for token in streamer:
    print(token, end="", flush=True)

thread.join()
```

## Training Details

| Property | Value |
|----------|-------|
| Compute | 80GB GPU cluster (4 GPUs) |
| Training Time | ~1,095 hours (1.5 months) |
| Pre-training Data | 1 billion tokens raw Solidity data |
| Fine-tuning Data | 650,000 curated instructions (Solidity >= 0.5, 200-4000 tokens) |

## Use Cases

- Smart contract development and prototyping
- Educational resources and tutorials
- Documentation and template creation
- IDE integrations and code assistants
- Autonomous blockchain agents

## Roadmap

| Milestone | Status |
|-----------|--------|
| Enhanced Solidity & OpenZeppelin support | Planned |
| Inline code editing | Planned |
| Rust/Solana support | Planned |
| Increased context length | Planned |
