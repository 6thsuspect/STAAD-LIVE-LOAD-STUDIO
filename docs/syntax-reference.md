# Generated syntax reference

All examples are taken from `samples/` and are produced deterministically by the generators.

## 1. Document skeleton

```
STAAD SPACE
* header comments: project, workflow, target release, mapping, units, notices
UNIT METER KN
<workflow body>
* footer comments
```

The header always records the coordinate mapping and the adapter status. Comment blocks state the
vehicle definition, its datum, its reference point, the number of positions and the load-transfer
method, so a reviewer can audit the assumptions without the application.

## 2. Moving-load generation

```
DEFINE MOVING LOAD
TYPE 1 LOAD 27 27 114 114 68 68 68 68 DISTANCE 1.1 3.2 1.2 4.3 3 3 3 WIDTH 2.3
LOAD 100 LOADTYPE LIVE TITLE IRC MOVING LOAD V1
LOAD GENERATION 20
TYPE 1 3.6 0 2.25 XINC 1
```

Rules applied by the generator:

| Rule | Detail |
|---|---|
| Load/distance count | `n` loads ⇒ `n − 1` distances, always |
| Reference | the first load of the definition, at the placement's reference point transformed to global coordinates |
| `WIDTH` | only for “axle loads + WIDTH”; omitted for explicit wheel lines and for “no WIDTH” |
| Tracked vehicles | one `DEFINE MOVING LOAD` and one `LOAD GENERATION` per track |
| Type numbers | allocated from the configured base, unique per emitted line |
| Anchor case | optional `LOAD n LOADTYPE … TITLE …` before `LOAD GENERATION` |
| Increment | `direction × increment × longitudinalSign`, written on the mapped longitudinal axis |
| Rotation | generation is blocked when the mapping rotation is non-zero |
| Impact | optional user multiplier applied to the emitted load values, recorded in comments |

Explicit wheel-line example (Class 70R wheeled):

```
DEFINE MOVING LOAD
TYPE 1 LOAD 40 60 60 85 85 85 85 DISTANCE 3.96 1.52 2.13 1.37 3.05 1.37
TYPE 2 LOAD 40 60 60 85 85 85 85 DISTANCE 3.96 1.52 2.13 1.37 3.05 1.37
```

The two lines sit at `±gauge/2`; the generation start coordinates differ accordingly.

## 3. Static placement

```
LOAD 301 LOADTYPE LIVE TITLE CLASS A V1 POS
JOINT LOAD
11 FY -2.295
12 FY -9.18
```

* Joint force components are in the mapped vertical global axis only; other components are omitted.
* Values are the sum of every wheel/track contribution at that joint, rounded to 4 decimals.
* A case is emitted only when all load points were transferred; otherwise a commented rejection block
  explains each unresolved point and no `JOINT LOAD` is written.
* Case numbers come from the placement's own number or the configured first number, validated unique.

## 4. Parser accept/reject summary

| Input | Result |
|---|---|
| `TYPE n LOAD … DISTANCE …` with the wrong distance count | error, definition not used |
| Unknown keyword in a `TYPE` line | error, line preserved |
| `LOAD GENERATION` without `TYPE` | error, line preserved |
| `TYPE` referencing an undefined definition | warning, no position invented |
| Definition without any generation or case | info, no placement created |
| `LOAD` case followed by `LOAD GENERATION` | treated as the moving-load anchor, not a static case |
| `JOINT LOAD` components other than FX/FY/FZ | warning, case not reconstructed |
| Non-metric `UNIT` | warning, values read as metres/kilonewtons |
| Any other command | preserved with a reason and line number |
