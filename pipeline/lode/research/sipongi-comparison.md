# SiPongi+ Feature Comparison

**Status:** not yet researched. Everything below comes from AGENTS.md and is unverified until
someone checks the official pages:
- https://sipongi.gakkum.kehutanan.go.id/peta
- https://sipongi.gakkum.kehutanan.go.id/sebaran-titik-panas

| Capability | SiPongi+ | Ours (planned) | Why it matters |
|-----------|----------|----------------|----------------|
| Hotspot map | reported, unverified | basic map only | not a differentiator |
| Filters (date, province, satellite, confidence) | reported, unverified | minimal | not a differentiator |
| Charts and downloads | reported, unverified | maybe | not a differentiator |
| MODIS–VIIRS harmonized series | **unknown** | core | consistent long-term comparison |
| Multi-year activity calendar | **unknown** | core | seasonal and recurring patterns |
| Baseline anomaly | **unknown** | priority 5 | unusual periods in context |
| Coverage and uncertainty display | **unknown** | core | trust and interpretation |

Rules: a feature is "absent" only when it is verified absent. Otherwise it stays **unknown**.
Data taken from SiPongi+ must cite "SIPONGI KEMENHUT".

```mermaid
flowchart LR
    R[Review SiPongi+ pages] --> V[record verified capabilities]
    V --> G[identify real gaps]
    G --> B[build only gap-demonstrating features]
```

```python
# No code. Research artifact only.
```

Related: [roadmap](../plans/roadmap.md)
