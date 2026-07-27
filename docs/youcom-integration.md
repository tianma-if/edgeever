# You.com Search Integration

EdgeEver now includes native You.com search capabilities through its MCP server, allowing AI agents to perform web searches and deep research directly within your notes workflow.

## Features

### Web Search (`youcom_search`)
- Real-time web search with customizable result count (1-20)
- Safe search filtering (strict/moderate/off)
- Country-specific localization
- Works in both authenticated and keyless modes

### Deep Research (`youcom_research`)
- Multi-source research synthesis with citations
- Comprehensive reports on complex topics
- Source attribution and reference management
- Requires API key for access

## Setup

### Option 1: Keyless Mode (Quickstart)
No setup required! The integration works immediately with:
- 100 free searches per day per IP
- Basic web search functionality
- No registration needed

### Option 2: API Key Mode (Recommended)
For higher quotas and research capabilities:

1. **Get API Key**: Visit [api.you.com](https://api.you.com/) to obtain your API key
2. **Configure Environment**: Set one of these environment variables:
   ```bash
   # Primary (recommended)
   YDC_API_KEY=your_api_key_here
   
   # Alternative for compatibility
   YOUCOM_API_KEY=your_api_key_here
   ```

3. **Deploy**: The integration automatically detects the API key and enables enhanced features

## Usage Examples

### Through MCP Tools

When your AI agent has MCP access to EdgeEver, it can use these tools:

```javascript
// Web search
{
  "name": "youcom_search",
  "arguments": {
    "query": "latest AI frameworks 2026",
    "count": 10,
    "safesearch": "moderate",
    "country": "US"
  }
}

// Deep research  
{
  "name": "youcom_research", 
  "arguments": {
    "query": "impact of AI agents on software development",
    "count": 5
  }
}
```

### Integration Workflow

1. **Capture Ideas**: Use EdgeEver to quickly capture thoughts and research topics
2. **AI Enhancement**: Let your AI agent search the web and research topics using You.com
3. **Synthesize Notes**: Agent can automatically enrich your notes with search results and research
4. **Export & Share**: Use EdgeEver's export features to share enriched content

## Error Handling

The integration handles common scenarios gracefully:

- **Rate Limits**: Clear error messages with upgrade suggestions
- **Authentication Issues**: Helpful guidance on API key configuration
- **Network Failures**: Graceful degradation with informative errors
- **Keyless Fallback**: Automatic fallback to keyless mode when API key is unavailable

## Benefits for EdgeEver Users

- **Seamless Integration**: Works within existing MCP workflow
- **No Vendor Lock-in**: Optional enhancement that doesn't change core functionality
- **Privacy-First**: API calls go directly to You.com, not through EdgeEver servers
- **Cost-Effective**: Generous free tier, transparent paid options

## API Reference

### `youcom_search`

**Parameters:**
- `query` (string, required): Search query
- `count` (integer, optional): Number of results (1-20, default: 10)
- `safesearch` (string, optional): Filter level ("strict", "moderate", "off", default: "moderate")  
- `country` (string, optional): Country code for localized results (e.g., "US", "GB")

**Response:**
```json
{
  "source": "you.com",
  "query": "your search query",
  "results": [
    {
      "title": "Result title",
      "url": "https://example.com",
      "snippet": "Result description..."
    }
  ],
  "timestamp": "2026-07-27T09:30:00Z",
  "note": "Using keyless You.com API (100 searches/day limit). Set YDC_API_KEY for higher quotas."
}
```

### `youcom_research`

**Parameters:**
- `query` (string, required): Research topic or question
- `count` (integer, optional): Number of sources (1-10, default: 5)

**Response:**
```json
{
  "source": "you.com", 
  "type": "research",
  "query": "your research query",
  "report": "Comprehensive research synthesis...",
  "sources": ["https://source1.com", "https://source2.com"],
  "citations": [
    {
      "title": "Source Title",
      "url": "https://source.com", 
      "excerpt": "Relevant excerpt..."
    }
  ],
  "timestamp": "2026-07-27T09:30:00Z"
}
```

## Security & Privacy

- **API Keys**: Stored securely as Cloudflare Worker secrets
- **Data Flow**: Direct communication with You.com API, no intermediary storage
- **Request Headers**: Include standard User-Agent for proper attribution
- **Rate Limiting**: Respects You.com API limits and provides clear feedback

## Contributing

This integration follows EdgeEver's existing MCP patterns. To extend or modify:

1. Review the implementation in `apps/api/src/index.ts`
2. Follow existing error handling and response formatting conventions
3. Update this documentation for any changes
4. Test both keyless and authenticated modes

## Support

For issues related to:
- **EdgeEver MCP Integration**: Open an issue in the EdgeEver repository
- **You.com API**: Contact You.com support or check their documentation
- **General Usage**: See EdgeEver's main documentation and MCP guides