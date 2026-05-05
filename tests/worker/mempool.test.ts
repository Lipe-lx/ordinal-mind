import { describe, expect, it } from "vitest"
import { findInscriptionOutputLocation, analyzeTransfer } from "../../src/worker/agents/mempool"

describe("findInscriptionOutputLocation", () => {
  it("tracks the sat into a non-zero vout using FIFO offset accounting", () => {
    const tx = {
      txid: "tx1",
      status: { confirmed: true, block_height: 1, block_time: 1710000000 },
      fee: 1000,
      vin: [
        { txid: "prev0", vout: 0, prevout: { scriptpubkey_address: "seller", value: 600 } },
        { txid: "prev1", vout: 1, prevout: { scriptpubkey_address: "buyer-funds", value: 1000 } },
      ],
      vout: [
        { scriptpubkey_address: "change", value: 400 },
        { scriptpubkey_address: "postage", value: 500 },
        { scriptpubkey_address: "payment", value: 700 },
      ],
    }

    expect(findInscriptionOutputLocation(tx as any, 1, 650)).toEqual({
      vout: 2,
      offset: 350,
    })
  })
})

describe("analyzeTransfer", () => {
  const mockTx = (params: any) => ({
    txid: "mock_tx",
    status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
    fee: 1000,
    vin: params.vin,
    vout: params.vout,
  })

  it("identifies a simple transfer correctly", () => {
    const tx = mockTx({
      vin: [{ prevout: { scriptpubkey_address: "ADDR_A", value: 10000 } }],
      vout: [{ scriptpubkey_address: "ADDR_B", value: 10000 }]
    })
    const res = analyzeTransfer(tx as any, 0, 0)
    expect(res.is_sale).toBe(false)
  })

  it("detects a marketplace sale using the 2-dummy pattern", () => {
    const tx = mockTx({
      vin: [
        { prevout: { scriptpubkey_address: "BUYER", value: 546 } },
        { prevout: { scriptpubkey_address: "BUYER", value: 546 } },
        { prevout: { scriptpubkey_address: "SELLER", value: 10000 } },
        { prevout: { scriptpubkey_address: "BUYER", value: 100000 } }
      ],
      vout: [
        { scriptpubkey_address: "SELLER", value: 95000 },
        { scriptpubkey_address: "MARKETPLACE", value: 2000 },
        { scriptpubkey_address: "BUYER", value: 10000 }, // Inscription
        { scriptpubkey_address: "BUYER", value: 546 },   // Dummy 1
        { scriptpubkey_address: "BUYER", value: 546 }    // Dummy 2
      ]
    })
    const res = analyzeTransfer(tx as any, 2, 2)
    expect(res.is_sale).toBe(true)
    expect(res.is_heuristic).toBe(false) // Confirmed marketplace
    expect(res.value).toBe(85000)
  })

  it("ignores high postage transfers even with multiple inputs", () => {
    const tx = mockTx({
      vin: [
        { prevout: { scriptpubkey_address: "ADDR_A", value: 50000 } },
        { prevout: { scriptpubkey_address: "ADDR_C", value: 5000 } }
      ],
      vout: [
        { scriptpubkey_address: "ADDR_B", value: 50000 },
        { scriptpubkey_address: "ADDR_C", value: 4000 }
      ]
    })
    const res = analyzeTransfer(tx as any, 0, 0)
    expect(res.is_sale).toBe(false)
  })

  it("identifies a P2P sale via heuristics", () => {
    const tx = mockTx({
      vin: [
        { prevout: { scriptpubkey_address: "SELLER", value: 10000 } },
        { prevout: { scriptpubkey_address: "BUYER", value: 100000 } }
      ],
      vout: [
        { scriptpubkey_address: "BUYER", value: 10000 },
        { scriptpubkey_address: "SELLER", value: 95000 }
      ]
    })
    const res = analyzeTransfer(tx as any, 0, 0)
    expect(res.is_sale).toBe(true)
    expect(res.is_heuristic).toBe(true)
    expect(res.value).toBe(85000)
  })
})
