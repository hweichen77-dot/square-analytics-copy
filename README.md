# Square Analytics

Sales analytics and inventory management for Walley's School Store, powered by Square POS data.

## Features

- Sales dashboard with revenue, transaction, and product metrics
- Inventory tracking and restock alerts
- Dead stock detection
- Staff performance analysis
- Product profit margins (requires cost data)
- Seasonal and time-based analysis
- Monthly income statement reports
- Catalogue management and audit tools
- Operating expense tracking
- Purchase order generation
- Accountant report export (PDF)

## Getting Started

1. Export transactions from Square Dashboard → Reports → Sales Summary → Export CSV
2. Open the app and go to **Import Data**
3. Drop the CSV file onto the import area
4. Analytics populate automatically

## Optional: Catalogue Import

Export your item library from Square Dashboard → Items → Export Library (XLSX).
Import via Import Data → Catalogue Import (XLSX) to enable price tracking and profit analysis.

## Optional: Square Live Sync

Requires a Square Developer account. See Square Sync page for setup instructions.

## Build

```bash
npm install
npm run tauri build
```

## Version

v1.6.1
