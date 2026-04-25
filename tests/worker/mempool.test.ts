import { describe, expect, it } from "vitest"
import { findInscriptionOutputLocation } from "../../src/worker/agents/mempool"

describe("findInscriptionOutputLocation", () => {
  it("tracks the sat into a non-zero vout using FIFO offset accounting", () => {
    const tx = {
      txid: "tx1",
      status: {
        confirmed: true,
        block_height: 1,
        block_time: 1710000000,
      },
      fee: 1000,
      vin: [
        {
          txid: "prev0",
          vout: 0,
          prevout: {
            scriptpubkey_address: "seller",
            value: 600,
          },
        },
        {
          txid: "prev1",
          vout: 1,
          prevout: {
            scriptpubkey_address: "buyer-funds",
            value: 1000,
          },
        },
      ],
      vout: [
        { scriptpubkey_address: "change", value: 400 },
        { scriptpubkey_address: "postage", value: 500 },
        { scriptpubkey_address: "payment", value: 700 },
      ],
    }

    expect(findInscriptionOutputLocation(tx, 1, 650)).toEqual({
      vout: 2,
      offset: 350,
    })
  })
})
