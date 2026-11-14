import { act, render, screen } from '@testing-library/react'
import { DataError, DataProvider, useResource, type DataClient } from '../../../src/data'

function Probe({ id, load }: { id: string | null; load: (c: DataClient) => Promise<string> }) {
  const r = useResource(id, load)
  return (
    <div>
      <span data-testid="status">{r.status}</span>
      {r.status === 'ready' && <span data-testid="data">{r.data}</span>}
      {r.status === 'error' && <span data-testid="error">{r.error.message}</span>}
      <button type="button" onClick={r.retry}>
        retry
      </button>
    </div>
  )
}

const client = {} as DataClient
const wrap = (ui: React.ReactNode) => <DataProvider client={client}>{ui}</DataProvider>

describe('useResource', () => {
  it('goes from loading to ready', async () => {
    render(wrap(<Probe id="a" load={async () => 'hello'} />))
    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    expect(await screen.findByTestId('data')).toHaveTextContent('hello')
  })

  it('reports errors and retries', async () => {
    let calls = 0
    const load = async () => {
      calls += 1
      if (calls === 1) throw new DataError('missing', 'x.json', 'not found')
      return 'second try'
    }
    render(wrap(<Probe id="a" load={load} />))
    expect(await screen.findByTestId('error')).toHaveTextContent('x.json: not found')

    await act(async () => screen.getByText('retry').click())
    expect(await screen.findByTestId('data')).toHaveTextContent('second try')
  })

  it('drops a stale result when the key changes', async () => {
    let resolveA: (v: string) => void = () => {}
    const load = (id: string) => () =>
      id === 'a' ? new Promise<string>((r) => (resolveA = r)) : Promise.resolve('B')
    const { rerender } = render(wrap(<Probe id="a" load={load('a')} />))
    rerender(wrap(<Probe id="b" load={load('b')} />))
    expect(await screen.findByTestId('data')).toHaveTextContent('B')

    await act(async () => resolveA('A'))
    expect(screen.getByTestId('data')).toHaveTextContent('B')
  })

  it('stays loading for a null key', () => {
    const load = vi.fn(async () => 'never')
    render(wrap(<Probe id={null} load={load} />))
    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    expect(load).not.toHaveBeenCalled()
  })
})
