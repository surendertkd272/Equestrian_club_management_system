// Shared helper for the horse-allocation engine (per-horse + lesson paths).
//
// Both paths do "read checks → insert" and must run inside an interactive
// transaction that first takes a `FOR UPDATE` lock on the horse row(s), so two
// concurrent allocations can't both pass the overlap/cap checks and then
// double-book a horse or bust the daily workload cap. Conflicts detected inside
// the transaction are thrown as AllocConflict and mapped to a 409 by the route.
export class AllocConflict extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AllocConflict";
    this.code = code;
  }
}
