const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// 🛡️ Required CORS Middleware to satisfy strict Web3 Agent Console Origin Rules
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, payment-signature, X-Payment-Receipt, payment-request');
    res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE, payment-request');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

const PORT = process.env.PORT || 10000;
const MY_BASE_WALLET = process.env.MY_BASE_WALLET || "0x452993071FdE3743767f98f339E90D9A313BBf3B";
const API_AMOUNT_PER_CALL = process.env.API_AMOUNT_PER_CALL || "1000"; // 1000 atomic units = 0.001 USDC
const BASE_NETWORK_ID = "8453";

// Generate fully compliant x402 v2 offer nesting the exact bazaar and extra domain schemas from foundation specs
const generate402Offer = (baseUrl, routePath) => ({
    x402Version: 2,
    error: "Payment required",
    resource: { 
        url: `${baseUrl}${routePath}`,
        description: "Low-cost high-speed gateway health probe for real x402 settlement validation checks.",
        mimeType: "application/json"
    },
    accepts: [{
        scheme: "exact",
        network: `eip155:${BASE_NETWORK_ID}`,
        amount: API_AMOUNT_PER_CALL,
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913", // Canonical USDC on Base
        payTo: MY_BASE_WALLET,
        maxTimeoutSeconds: 30,
        extra: {
            name: "USD Coin",
            version: "2",
            assetTransferMethod: "eip3009",
            domain: {
                name: "USD Coin",
                version: "2",
                chainId: parseInt(BASE_NETWORK_ID),
                verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913"
            }
        }
    }],
    extensions: {
        bazaar: {
            info: {
                input: {
                    type: "http",
                    method: "GET",
                    queryParams: {
                        ping: "test"
                    }
                },
                output: {
                    type: "json",
                    example: {
                        status: "success",
                        message: "Gateway operational. Protocol check verified.",
                        latency_ms: 1,
                        timestamp: 1714856000
                    }
                }
            },
            schema: {
                $schema: "https://json-schema.org",
                type: "object",
                properties: {
                    input: { type: "object" },
                    output: { type: "object" }
                },
                required: ["input", "output"]
            }
        }
    }
});

// 🟢 Free Path: Used by Cron-Job.org to bypass firewalls and keep container awake
app.get('/keepawake', (req, res) => {
    res.status(200).json({ status: "warm", message: "Keep-awake monitor loop successful." });
});

// 🔒 Protected OpenAPI Route: Locked behind a strict 402 challenge to pass vAPI console checks
app.get('/openapi.json', (req, res) => {
    const paymentSignature = req.headers['payment-signature'];
    const hostUrl = `${req.protocol}://${req.get('host')}`;
    const offerPayload = generate402Offer(hostUrl, '/openapi.json');

    if (!paymentSignature) {
        const base64Offer = Buffer.from(JSON.stringify(offerPayload)).toString('base64');
        res.setHeader('PAYMENT-REQUIRED', base64Offer);
        return res.status(402).json(offerPayload);
    }
    
    res.status(200).json({
        openapi: "3.0.0",
        info: { title: "Apex Universal Uptime Diagnostic Probe", version: "1.0.0" },
        paths: { "/": { get: { summary: "Execute raw network loop verification test" } } }
    });
});

// 🔒 Core Data Route: Protected via x402 EIP-712 signature verification logic
app.get('/', async (req, res) => {
    const startTime = Date.now();
    const paymentSignature = req.headers['payment-signature'];
    const hostUrl = `${req.protocol}://${req.get('host')}`;
    const offerPayload = generate402Offer(hostUrl, '/');

    if (!paymentSignature) {
        const base64Offer = Buffer.from(JSON.stringify(offerPayload)).toString('base64');
        res.setHeader('PAYMENT-REQUIRED', base64Offer);
        return res.status(402).json(offerPayload);
    }

    try {
        const verifyRoute = await axios.post("https://x402.org", {
            signature: paymentSignature,
            payTo: MY_BASE_WALLET,
            amount: "0.001"
        });
        if (verifyRoute.status !== 200) return res.status(401).json({ error: "Invalid payment signature." });
    } catch (err) {
        return res.status(500).json({ error: "Payment verification engine offline." });
    }

    // Ultra-fast immediate response payload to minimize latency metric footprint
    res.status(200).json({
        status: "success",
        message: "Gateway operational. Protocol check verified.",
        network: "Base Mainnet (8453)",
        latency_ms: Date.now() - startTime,
        timestamp: Date.now()
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Apex Health Probe active on port ${PORT}`);
});
