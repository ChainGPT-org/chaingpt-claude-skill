// ChainGPT AI News fetch — minimal Go example.
//
// Demonstrates calling the public ChainGPT AI News endpoint with nothing but
// the Go standard library (net/http + encoding/json). No SDK dependency.
//
// Run:
//   go mod init chaingpt-news-example   # one-time
//   CHAINGPT_API_KEY=… go run main.go
//
// Endpoint reference: https://docs.chaingpt.org/dev-docs-b2b-saas-api-and-sdk
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// NewsAPIBase points at the public ChainGPT gateway. Override via
// $CHAINGPT_API_BASE for testing against the mock server.
const NewsAPIBase = "https://api.chaingpt.org/news/getNews"

type NewsRequest struct {
	CategoryID    []int    `json:"categoryId,omitempty"`
	SubCategoryID []int    `json:"subCategoryId,omitempty"`
	TokenID       []int    `json:"tokenId,omitempty"`
	Limit         int      `json:"limit,omitempty"`
	Offset        int      `json:"offset,omitempty"`
	SortBy        string   `json:"sortBy,omitempty"`        // "createdAt" | "publishedAt" | "trending"
	SortOrder     string   `json:"sortOrder,omitempty"`     // "ASC" | "DESC"
	SearchQuery   string   `json:"searchQuery,omitempty"`
	FetchAfter    string   `json:"fetchAfter,omitempty"`    // ISO-8601
	WordLimit     int      `json:"wordLimit,omitempty"`     // truncate description
	Languages     []string `json:"languages,omitempty"`     // e.g. ["en"]
}

type NewsItem struct {
	ID          int    `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	URL         string `json:"url"`
	PublishedAt string `json:"publishedAt"`
}

type NewsResponse struct {
	Data []NewsItem `json:"data"`
	Meta struct {
		Total      int `json:"total"`
		PageSize   int `json:"pageSize"`
		PageNumber int `json:"pageNumber"`
	} `json:"meta"`
}

func main() {
	apiKey := os.Getenv("CHAINGPT_API_KEY")
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "CHAINGPT_API_KEY not set. Get one at https://app.chaingpt.org")
		os.Exit(1)
	}

	apiBase := os.Getenv("CHAINGPT_API_BASE")
	if apiBase == "" {
		apiBase = NewsAPIBase
	}

	req := NewsRequest{
		Limit:     5,
		SortBy:    "publishedAt",
		SortOrder: "DESC",
		Languages: []string{"en"},
	}

	resp, err := fetchNews(apiBase, apiKey, req)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}

	fmt.Printf("=== Latest %d crypto-news items ===\n\n", len(resp.Data))
	for i, item := range resp.Data {
		fmt.Printf("[%d] %s\n    %s\n    %s\n\n", i+1, item.Title, item.URL, item.PublishedAt)
	}
}

func fetchNews(apiBase, apiKey string, req NewsRequest) (*NewsResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequest(http.MethodPost, apiBase, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("User-Agent", "chaingpt-news-example-go/1.0")

	client := &http.Client{Timeout: 30 * time.Second}
	httpResp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	defer httpResp.Body.Close()

	respBody, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	if httpResp.StatusCode != http.StatusOK {
		// Surface the upstream message verbatim so the developer can debug auth issues etc.
		return nil, errors.New(fmt.Sprintf("HTTP %d: %s", httpResp.StatusCode, string(respBody)))
	}

	var news NewsResponse
	if err := json.Unmarshal(respBody, &news); err != nil {
		return nil, fmt.Errorf("decode JSON: %w (body=%s)", err, string(respBody))
	}
	return &news, nil
}
