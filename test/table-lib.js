/*
** The Ring half, tested with no page at all.
**
**   node test/table-lib.js
**
** Needs a checkout of github.com/mayouni/ringscript beside this one, or
** RINGSCRIPT_HOME pointing at one.
*/
const fs = require("fs"), path = require("path");
const HOME = process.env.RINGSCRIPT_HOME || path.join(__dirname, "..", "..", "ringscript");
const RT = path.join(HOME, "playground");
if (!fs.existsSync(path.join(RT, "ringscript.wasm"))) {
    console.error("No RingScript runtime at " + RT); process.exit(2);
}
const RingScript = require(path.join(RT, "ringscript.js"));
const SRC = fs.readFileSync(path.join(__dirname, "..", "ring", "table.ring"), "utf8");

let bad = 0;
const ok = (n, c, d) => {
    console.log((c ? "  PASS  " : "  FAIL  ") + n + (c || d === undefined ? "" : "  [" + JSON.stringify(d) + "]"));
    if (!c) bad++;
};

(async () => {
    const b = fs.readFileSync(path.join(RT, "ringscript.wasm"));
    const bytes = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    const mk = async () => {
        const vm = await RingScript.load(bytes, { onOutput: () => {} });
        const e = vm.eval(SRC);
        if (!e.ok) { console.log("EVAL FAILED: " + e.error); process.exit(1); }
        return vm;
    };
    const P = (vm, f, a) => {
        const r = vm.call(f, a === undefined ? 1 : a);
        if (!r.ok) throw new Error(f + ": " + r.error);
        const v = r.result; if (typeof v !== "string") return v;
        const t = v.trim(); return (t[0] === "{" || t[0] === "[") ? JSON.parse(t) : v;
    };
    const COLS = ["id", "member", "amount", "status"];
    const ROWS = [[1,"m03",250,"ACTIVE"],[2,"m01",900,"ACTIVE"],
                  [3,"m03",100,"CLOSED"],[4,"m02",400,"ACTIVE"],[5,"m01",600,"ACTIVE"]];
    const load = (vm) => P(vm, "TableLoad", JSON.stringify([["columns", COLS], ["rows", ROWS]]));

    let vm = await mk();
    ok("load reports rows and columns", load(vm).rows === 5);
    ok("columns come back", JSON.stringify(P(vm, "TableColumns", 0)) === JSON.stringify(COLS));
    ok("a table with no columns is refused",
       P(vm, "TableLoad", JSON.stringify([["rows", []]])).ok === 0);

    // filtering
    let f = P(vm, "TableFilter", JSON.stringify([[["column","status"],["op","eq"],["value","ACTIVE"]]]));
    ok("filter narrows the view", f.shown === 4 && f.of === 5, f);
    ok("an unknown column is refused",
       P(vm, "TableFilter", JSON.stringify([[["column","nope"],["op","eq"],["value",1]]])).ok === 0);
    f = P(vm, "TableFilter", JSON.stringify([[["column","status"],["op","eq"],["value","ACTIVE"]],
                                             [["column","amount"],["op","ge"],["value",400]]]));
    ok("every test must pass", f.shown === 3, f);
    ok("contains is case-insensitive",
       P(vm, "TableFilter", JSON.stringify([[["column","member"],["op","contains"],["value","M0"]]])).shown === 5);
    ok("filter rebuilds from all rows, never stacking",
       P(vm, "TableFilter", JSON.stringify([[["column","status"],["op","eq"],["value","CLOSED"]]])).shown === 1);
    ok("all() restores the view", P(vm, "TableAll", 0) === 5);

    // sorting
    P(vm, "TableSort", JSON.stringify([["column","amount"],["desc",0]]));
    let page = P(vm, "TablePage", JSON.stringify([["from",1],["count",5]]));
    ok("ascending sort orders the view", page.map(r => r[2]).join(",") === "100,250,400,600,900", page.map(r=>r[2]));
    P(vm, "TableSort", JSON.stringify([["column","amount"],["desc",1]]));
    page = P(vm, "TablePage", JSON.stringify([["from",1],["count",2]]));
    ok("descending sort reverses it", page[0][2] === 900 && page[1][2] === 600);
    ok("sorting an unknown column is refused",
       P(vm, "TableSort", JSON.stringify([["column","nope"]])).ok === 0);

    // paging
    ok("a page past the end is short, not an error",
       P(vm, "TablePage", JSON.stringify([["from",4],["count",25]])).length === 2);
    ok("from below 1 is clamped",
       P(vm, "TablePage", JSON.stringify([["from",0],["count",1]])).length === 1);
    ok("row() reads one position", P(vm, "TableRow", 1).row[2] === 900);
    ok("row() out of range is refused", P(vm, "TableRow", 99).ok === 0);

    // aggregating
    let a = P(vm, "TableAggregate", JSON.stringify([["column","amount"]]));
    ok("aggregate over everything", a.sum === 2250 && a.min === 100 && a.max === 900 && a.count === 5, a);
    P(vm, "TableFilter", JSON.stringify([[["column","status"],["op","eq"],["value","ACTIVE"]]]));
    a = P(vm, "TableAggregate", JSON.stringify([["column","amount"]]));
    ok("aggregate follows the view, not the table", a.sum === 2150 && a.count === 4, a);
    a = P(vm, "TableAggregate", JSON.stringify([["column","member"]]));
    ok("non-numeric cells are skipped and counted, not zeroed",
       a.count === 0 && a.skipped === 4 && a.sum === 0, a);

    // grouping
    P(vm, "TableAll", 0);
    let g = P(vm, "TableGroup", JSON.stringify([["by","member"],["value","amount"],["top",10]]));
    ok("groups are ranked by total", g[0].group === "m01" && g[0].total === 1500, g[0]);
    ok("group counts its rows", g.find(x => x.group === "m03").count === 2, g);
    ok("top limits the result", P(vm, "TableGroup", JSON.stringify([["by","member"],["value","amount"],["top",1]])).length === 1);
    ok("grouping an unknown column is refused",
       P(vm, "TableGroup", JSON.stringify([["by","nope"]])).ok === 0);

    // writing
    ok("append extends the table", P(vm, "TableAppend", JSON.stringify([6,"m04",1000,"ACTIVE"])).rows === 6);
    ok("a wrong-width row is refused", P(vm, "TableAppend", JSON.stringify([7,"m05"])).ok === 0);
    a = P(vm, "TableAggregate", JSON.stringify([["column","amount"]]));
    ok("the appended row is included", a.sum === 3250, a);
    ok("set changes a cell",
       P(vm, "TableSet", JSON.stringify([["at",1],["column","amount"],["value",5]])).ok === 1);
    ok("set out of range is refused",
       P(vm, "TableSet", JSON.stringify([["at",99],["column","amount"],["value",1]])).ok === 0);

    // the index: correctness must not depend on it
    const vmA = await mk(); load(vmA);
    const vmB = await mk(); P(vmB, "TableIndexFloor", 1e9); load(vmB);
    for (const v of [vmA, vmB]) {
        P(v, "TableSort", JSON.stringify([["column","amount"],["desc",1]]));
    }
    const rA = P(vmA, "TableAggregate", JSON.stringify([["column","amount"]]));
    const rB = P(vmB, "TableAggregate", JSON.stringify([["column","amount"]]));
    ok("indexed and unindexed agree exactly", JSON.stringify(rA) === JSON.stringify(rB), {rA, rB});
    const pA = P(vmA, "TablePage", JSON.stringify([["from",1],["count",5]]));
    const pB = P(vmB, "TablePage", JSON.stringify([["from",1],["count",5]]));
    ok("...and so do their pages", JSON.stringify(pA) === JSON.stringify(pB));

    // restart
    const snap = vm.call("TableSnapshot", 0).result;
    const vm2 = await mk();
    ok("restore returns the row count", P(vm2, "TableRestore", snap) === 6);
    ok("restored data is intact",
       P(vm2, "TableAggregate", JSON.stringify([["column","amount"]])).sum === 3005, 
       P(vm2, "TableAggregate", JSON.stringify([["column","amount"]])));
    ok("restore of nothing is harmless", P(vm2, "TableRestore", "") === 0);

    console.log(bad ? "\n" + bad + " FAILED" : "\nAll table.ring checks passed.");
    process.exit(bad ? 1 : 0);
})().catch(e => { console.error("ERROR", e.message); process.exit(1); });
