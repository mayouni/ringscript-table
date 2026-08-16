# ringscript-table

**Rows on the device: filter, sort, page, aggregate and group — with the
index that keeps a sorted read from going quadratic.**

A RingScript library. The decisions live in Ring; your page keeps its own
HTML and CSS.

```bash
ringscript add table
```

```html
<script src="lib/table/table.js"></script>
```

```js
const t = await Table.attach(ring);

t.load(["id", "member", "amount", "status"], rows);

t.filter([{ column: "status", op: "eq", value: "ACTIVE" }]);
t.sort("amount", true);

render(t.page(1, 25));
const totals = t.aggregate("amount");     // sum, min, max, avg, count
const top    = t.group("member", "amount", 5);
```

## Why this is a library

Three applications wrote it: a savings-circle register, a field-sales order
pad and a stock-count pad. All three held rows on the device, all three
needed the same five verbs — and one of them discovered, the expensive way,
that getting the index wrong turns a linear pass into a quadratic one.

## Three decisions, each learned by measurement

**Columns, not records.** The same 20,000 deposits as JSON objects cost
1,358 ms and 89 MB to load; as arrays, 71 ms and 23 MB. Nineteen times
faster for the same data. A table here is one list per column, and a row is
an index.

**A view is a list of indices.** Filter and sort rewrite the view; nothing
copies data. Sorting 20,000 rows moves 20,000 numbers, not 20,000 records.

**The index is explicit, and rebuilt at most once.** A Ring list is a linked
list with a cursor: sequential reads are O(1), random reads walk — and
reading through a *sorted* view is random. `ringvm_genarray()` builds the
index that fixes it, and it is opt-in for a good reason: any structural
change frees it, and rebuilding after every append costs O(n) per append.
So the index is marked stale on a write and rebuilt at most once before the
next read that needs it.

That last one is what the library is really for. 20,000 rows, sorted by
amount, then read through:

| operation | no index | indexed | |
|---|---:|---:|---|
| aggregate | 169 ms | 16 ms | **11×** |
| group | 572 ms | 39 ms | **15×** |
| paging | 119 ms | 18 ms | **7×** |
| sort | 50 ms | 52 ms | — |

Sort is unchanged because it builds its keys sequentially. Everything that
reads *through* the sorted view is transformed. Checksums agree in both
columns — the index changes the cost, never the answer, and there is a test
that asserts exactly that.

Run it yourself:

```bash
node test/bench.js 20000
```

## The API

**Loading** — `load(columns, rows)` · `restore(json)` · `snapshot()`

**The view** — `filter(tests)` · `all()` · `sort(column, desc)`
Filter tests are `{ column, op, value }` and *every* test must pass.
Ops: `eq` `ne` `gt` `ge` `lt` `le` `contains` `starts`.

**Reading** — `page(from, count)` · `row(at)` · `count()` · `viewCount()` ·
`columns()`

**Answers** — `aggregate(column)` → sum, min, max, avg, count, skipped ·
`group(by, value, top)` → totals per group, biggest first

Both work over the **current view**, so they answer *"what am I looking
at"* rather than *"what is in the table"*.

**Writing** — `append(row)` · `set(at, column, value)`

**The index** — `index()` builds it now rather than at the next read;
`indexFloor(n)` sets the row count below which indexing is not worth the
allocation. Setting it above your row count disables indexing, which is how
the table above was measured.

## Notes worth knowing

- **Non-numeric cells in an aggregate are skipped and counted**, never
  silently treated as zero. `aggregate()` returns `skipped` so you can tell.
- **`filter()` rebuilds from all rows**, so filters never stack by accident.
- **`set()` does not invalidate the index** — changing a cell is not a
  structural change to the list.

## Tests

```bash
node test/table-lib.js
```

Thirty-two checks on the Ring half, run in Node with no browser: the
refusals, the view semantics, the boundaries, and that **indexed and
unindexed produce byte-identical answers**.

Needs a checkout of [ringscript](https://github.com/mayouni/ringscript)
beside this one, or `RINGSCRIPT_HOME` pointing at one.

MIT. Part of the [RingScript](https://github.com/mayouni/ringscript) project.
