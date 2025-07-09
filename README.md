# MediaSoup Multi-Node Live Video Streaming

> **⚠️ Known Issue:**
> 
> Cross-node piping (fan-out) between SFU nodes is currently not fully functional. Streams can only be piped and consumed on the node where they are produced. Attempts to fan-out to other SFU nodes (e.g., sfu2, sfu3) will not work as expected. See log output below for details:
>
> ```
> [SFU1] 🔍 [MESH] Found 2 target nodes for fan-out: [ 'sfu3', 'sfu2' ]
> [SFU1] 🔄 [MESH] Piping to node sfu3 for producer ...
> [SFU1] ❌ [MESH] No existing pipe transport found: sfu1 -> sfu3
> [SFU1] 🔄 [MESH] Piping to node sfu2 for producer ...
> [SFU1] ❌ [MESH] No existing pipe transport found: sfu1 -> sfu2
> [SFU2] 📊 [API] Returning 0 streams from node sfu2
> [SFU3] 📊 [API] Returning 0 streams from node sfu3
> ```
>
> Only the local SFU node (e.g., sfu1) will show active streams. This is a known limitation and is being actively worked on.

**How to Run:**

1. Install dependencies:
   ```bash
   npm i
   ```
2. Start all servers:
   ```bash
   node scripts/start-all.js
   ```
3. Initialize mesh links:
   ```bash
   node scripts/init-pipe-links.js
   ```

A distributed SFU (Selective Forwarding Unit) system built with MediaSoup, featuring three SFU nodes and a simple web-based test interface.

## 🏗️ Architecture

```
┌───────────────┐      ┌───────────────┐
│   Web Client  │◄────►│   Signaling   │
│ (Publisher/   │      │   Server      │
│  Subscriber)  │      │  (Port 3000)  │
└───────┬───────┘      └───────┬───────┘
        │                      │
        ▼                      ▼
                ┌─────────────────────────────┐
                │        Coordinator          │
                │        (Port 4000)          │
                └───────┬───────────┬─────────┘
                        │           │
        ┌───────────────┴─────┬─────┴───────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  SFU Node 1   │    │  SFU Node 2   │    │  SFU Node 3   │
│  (Port 3001)  │    │  (Port 3002)  │    │  (Port 3003)  │
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        └──────────────┬─────┴─────┬──────────────┘
                       ▼           ▼
                ┌─────────────────────┐
                │   Metrics/Monitor   │
                │     (Port 2020)     │
                └─────────────────────┘
```

## Test Interface

Open the test dashboard at:

- http://localhost:2020/index.html

## License

MIT License - see LICENSE file for details

---

**Happy Streaming! 🎥**
