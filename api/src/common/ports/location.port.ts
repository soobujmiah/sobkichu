/**
 * Location port — the interface other modules call instead of reading the
 * `location` table.
 *
 * `location` owns the BD administrative hierarchy. Same-city determination
 * lives behind this port because it drives the regulated delivery clock
 * (DCOG 2021, compliance row C4) and must not be re-implemented per caller.
 */

export const LOCATION_PORT = Symbol('LOCATION_PORT');

/**
 * A resolved address. Mirrors the hierarchy in the canonical model:
 * Division -> District (Zila) -> Upazila/Thana -> Union/Ward -> Village/Mohalla.
 *
 * `geo` is optional by design: GPS is unreliable in dense low-rise areas and
 * absent for many indoor merchants, so the manual address path is
 * first-class, not a degraded fallback.
 *
 * `lat`/`lng` are exposed (not just `hasGeo`) because `catalog` needs the raw
 * coordinates to denormalise a listing's `geo` column at creation time --
 * radius search runs entirely against `listing.geo`, never joining back to
 * `location` (docs/architecture/backend-modules.md boundary rule 1). Both are
 * null exactly when `hasGeo` is false.
 */
export interface ResolvedLocation {
  readonly id: string;
  readonly division: string;
  readonly district: string;
  readonly upazilaThana: string;
  readonly unionWard: string | null;
  readonly villageMohalla: string | null;
  readonly addressLine: string | null;
  readonly hasGeo: boolean;
  readonly lat: number | null;
  readonly lng: number | null;
}

export interface LocationPort {
  /** Throws when the id is unknown. */
  findById(locationId: string): Promise<ResolvedLocation>;
}
