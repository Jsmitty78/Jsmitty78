Write code optimized for a junior developer to understand. Prefer linear procedural code, with loops and if statements, over functional programming or complex abstractions. Avoid clever code.

``` typescript
// 👎 BAD
Array.from(new Set(array)).map((x) => x * 2).filter((x) => x > 10);

// 👍 GOOD
const result: number[] = [];
const seen = new Set<number>();
for (const x of array) {
  if (seen.has(x)) {
    continue;
  }
  seen.add(x);
  const doubled = x * 2;
  if (doubled > 10) {
    result.push(doubled);
  }
}
```
