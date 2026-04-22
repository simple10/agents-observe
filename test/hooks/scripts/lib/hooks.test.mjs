import { describe, it, expect } from 'vitest'
import { __testing } from '../../../../hooks/scripts/lib/hooks.mjs'

const { stripLargeImageData } = __testing

function makeImagePayload(dataLen) {
  return {
    tool_response: [
      { type: 'text', text: 'Took a screenshot.' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'A'.repeat(dataLen),
        },
      },
    ],
  }
}

describe('stripLargeImageData', () => {
  it('replaces image data over the threshold with [REDACTED]', () => {
    const payload = makeImagePayload(5000)
    stripLargeImageData(payload, 2000)
    expect(payload.tool_response[1].source.data).toBe('[REDACTED]')
    // text items are untouched
    expect(payload.tool_response[0].text).toBe('Took a screenshot.')
  })

  it('leaves small image data verbatim', () => {
    const payload = makeImagePayload(500)
    stripLargeImageData(payload, 2000)
    expect(payload.tool_response[1].source.data).toBe('A'.repeat(500))
  })

  it('leaves data exactly at the threshold verbatim', () => {
    const payload = makeImagePayload(2000)
    stripLargeImageData(payload, 2000)
    expect(payload.tool_response[1].source.data).toBe('A'.repeat(2000))
  })

  it('does nothing when maxChars is 0 (redaction disabled)', () => {
    const payload = makeImagePayload(100000)
    stripLargeImageData(payload, 0)
    expect(payload.tool_response[1].source.data).toBe('A'.repeat(100000))
  })

  it('does nothing when maxChars is unset', () => {
    const payload = makeImagePayload(100000)
    stripLargeImageData(payload, undefined)
    expect(payload.tool_response[1].source.data).toBe('A'.repeat(100000))
  })

  it('handles payloads with no tool_response', () => {
    const payload = { tool_name: 'Bash', tool_input: { command: 'ls' } }
    expect(() => stripLargeImageData(payload, 2000)).not.toThrow()
  })

  it('handles tool_response that is not an array (Bash-style object)', () => {
    const payload = { tool_response: { stdout: 'hello', stderr: '' } }
    expect(() => stripLargeImageData(payload, 2000)).not.toThrow()
    expect(payload.tool_response).toEqual({ stdout: 'hello', stderr: '' })
  })

  it('skips non-image items in the response array', () => {
    const payload = {
      tool_response: [{ type: 'text', text: 'hi' }, { type: 'unknown', some: 'thing' }, null],
    }
    expect(() => stripLargeImageData(payload, 2000)).not.toThrow()
    expect(payload.tool_response[0].text).toBe('hi')
  })

  it('skips image items whose source is not base64', () => {
    const payload = {
      tool_response: [
        {
          type: 'image',
          source: { type: 'url', url: 'https://example.com/big.png' },
        },
      ],
    }
    stripLargeImageData(payload, 2000)
    expect(payload.tool_response[0].source.url).toBe('https://example.com/big.png')
  })

  it('redacts multiple oversized images in the same response', () => {
    const payload = {
      tool_response: [
        { type: 'image', source: { type: 'base64', data: 'A'.repeat(3000) } },
        { type: 'image', source: { type: 'base64', data: 'B'.repeat(4000) } },
      ],
    }
    stripLargeImageData(payload, 2000)
    expect(payload.tool_response[0].source.data).toBe('[REDACTED]')
    expect(payload.tool_response[1].source.data).toBe('[REDACTED]')
  })

  it('handles null payload without throwing', () => {
    expect(() => stripLargeImageData(null, 2000)).not.toThrow()
    expect(() => stripLargeImageData(undefined, 2000)).not.toThrow()
  })
})
