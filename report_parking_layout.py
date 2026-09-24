"""Report on the level 2 parking DXF and optionally build its stall registry."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import statistics
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

try:
    import ezdxf
    from ezdxf import bbox, path as ezdxf_path
    from ezdxf.lldxf.const import DXFStructureError
    from ezdxf.math import Vec2, is_point_in_polygon_2d
except ModuleNotFoundError:
    print(
        "Missing dependency: ezdxf. Install it with: python -m pip install ezdxf",
        file=sys.stderr,
    )
    raise SystemExit(2)


REPO_ROOT = Path(__file__).resolve().parent
DEFAULT_DXF = REPO_ROOT / "private" / "parking-layout-level-2.dxf"
REGISTRY_DIRECTORY = REPO_ROOT / "data" / "garage"
STALL_LAYER = "PK-STALL"
ZONE_LAYER_PATTERN = re.compile(r"^F2-Z(?:0[1-9]|10)$", re.IGNORECASE)
EXPECTED_ZONE_IDS = tuple(f"F2-Z{number:02d}" for number in range(1, 11))
SOURCE_FLOOR = 2
SHARED_GEOMETRY_FLOORS = (2, 3, 4, 5)
DEFAULT_EXPECTED_STALL_COUNT = 170
CURVE_FLATTENING_TOLERANCE_FEET = 0.001
AREA_OUTLIER_FRACTION = 0.25


@dataclass(frozen=True)
class Stall:
    number: int
    handle: str
    min_x: float
    min_y: float
    max_x: float
    max_y: float

    @property
    def center(self) -> Vec2:
        return Vec2((self.min_x + self.max_x) / 2, (self.min_y + self.max_y) / 2)

    @property
    def width(self) -> float:
        return self.max_x - self.min_x

    @property
    def height(self) -> float:
        return self.max_y - self.min_y

    @property
    def area(self) -> float:
        return self.width * self.height


@dataclass
class Assignments:
    unique_by_zone: dict[str, list[Stall]]
    unassigned: list[Stall]
    ambiguous: list[tuple[Stall, list[str]]]


def positive_integer(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("expected a positive integer")
    return parsed


def shared_geometry_floor(value: str) -> int:
    parsed = int(value)
    if parsed not in SHARED_GEOMETRY_FLOORS:
        choices = ", ".join(map(str, SHARED_GEOMETRY_FLOORS))
        raise argparse.ArgumentTypeError(f"expected one of: {choices}")
    return parsed


def registry_path(floor_number: int) -> Path:
    return REGISTRY_DIRECTORY / f"floor-{floor_number}.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Print stall counts, zone assignments, and geometry ranges from a DXF; "
            "optionally write the validated floor registry."
        )
    )
    parser.add_argument(
        "dxf",
        nargs="?",
        type=Path,
        default=DEFAULT_DXF,
        help=f"DXF to inspect (default: {DEFAULT_DXF})",
    )
    parser.add_argument(
        "--write-json",
        action="store_true",
        help="write the validated registry to data/garage/floor-N.json",
    )
    floor_group = parser.add_mutually_exclusive_group()
    floor_group.add_argument(
        "--floor",
        type=shared_geometry_floor,
        default=SOURCE_FLOOR,
        metavar="N",
        help=f"target floor for IDs and output filename (default: {SOURCE_FLOOR})",
    )
    floor_group.add_argument(
        "--all-shared-floors",
        action="store_true",
        help="generate levels 2, 3, 4, and 5 from the level-2 DXF",
    )
    parser.add_argument(
        "--expect-count",
        type=positive_integer,
        default=DEFAULT_EXPECTED_STALL_COUNT,
        metavar="N",
        help=(
            "required stall count when writing JSON "
            f"(default: {DEFAULT_EXPECTED_STALL_COUNT})"
        ),
    )
    return parser.parse_args()


def entity_handle(entity: object) -> str:
    handle = getattr(getattr(entity, "dxf", None), "handle", None)
    return str(handle) if handle else "unknown"


def read_stalls(modelspace: object) -> list[Stall]:
    stall_entities = [
        entity
        for entity in modelspace
        if entity.dxftype() == "LWPOLYLINE"
        and entity.dxf.layer.casefold() == STALL_LAYER.casefold()
    ]

    stalls: list[Stall] = []
    for number, entity in enumerate(stall_entities, start=1):
        entity_box = bbox.extents([entity], fast=False)
        if not entity_box.has_data:
            raise ValueError(
                f"Stall #{number} (handle {entity_handle(entity)}) has no usable geometry."
            )

        stalls.append(
            Stall(
                number=number,
                handle=entity_handle(entity),
                min_x=entity_box.extmin.x,
                min_y=entity_box.extmin.y,
                max_x=entity_box.extmax.x,
                max_y=entity_box.extmax.y,
            )
        )
    return stalls


def boundary_polygon(entity: object) -> list[Vec2]:
    """Return WCS polygon vertices, flattening any bulged/curved segments."""
    boundary_path = ezdxf_path.make_path(entity)
    vertices = [
        Vec2(vertex.x, vertex.y)
        for vertex in boundary_path.flattening(
            distance=CURVE_FLATTENING_TOLERANCE_FEET
        )
    ]
    if len(vertices) > 3:
        first = vertices[0]
        last = vertices[-1]
        if math.isclose(first.x, last.x, abs_tol=1e-9) and math.isclose(
            first.y, last.y, abs_tol=1e-9
        ):
            vertices.pop()
    if len(vertices) < 3:
        raise ValueError(
            f"Zone boundary handle {entity_handle(entity)} has fewer than 3 vertices."
        )
    return vertices


def read_zone_polygons(modelspace: object) -> dict[str, list[Vec2]]:
    zone_entities: dict[str, list[object]] = {}
    for entity in modelspace:
        layer = entity.dxf.layer.upper()
        if entity.dxftype() == "LWPOLYLINE" and ZONE_LAYER_PATTERN.fullmatch(layer):
            zone_entities.setdefault(layer, []).append(entity)

    errors: list[str] = []
    polygons: dict[str, list[Vec2]] = {}
    for zone_id in EXPECTED_ZONE_IDS:
        entities = zone_entities.get(zone_id, [])
        if len(entities) != 1:
            errors.append(
                f"Layer {zone_id} has {len(entities)} LWPOLYLINE entities; expected exactly 1."
            )
            continue

        boundary = entities[0]
        if not boundary.closed:
            errors.append(
                f"Layer {zone_id} boundary (handle {entity_handle(boundary)}) is not closed."
            )
            continue

        try:
            polygons[zone_id] = boundary_polygon(boundary)
        except ValueError as error:
            errors.append(f"Layer {zone_id}: {error}")

    if errors:
        raise ValueError("Invalid zone geometry:\n  - " + "\n  - ".join(errors))
    return polygons


def assign_stalls(stalls: list[Stall], zones: dict[str, list[Vec2]]) -> Assignments:
    unique_by_zone: dict[str, list[Stall]] = {
        zone_id: [] for zone_id in EXPECTED_ZONE_IDS
    }
    unassigned: list[Stall] = []
    ambiguous: list[tuple[Stall, list[str]]] = []

    for stall in stalls:
        # A point on a polygon edge returns 0 and is treated as contained. This
        # makes a point on a shared edge show up as an explicit ambiguity.
        matching_zones = [
            zone_id
            for zone_id, polygon in zones.items()
            if is_point_in_polygon_2d(stall.center, polygon) >= 0
        ]
        if len(matching_zones) == 1:
            unique_by_zone[matching_zones[0]].append(stall)
        elif not matching_zones:
            unassigned.append(stall)
        else:
            ambiguous.append((stall, matching_zones))

    return Assignments(unique_by_zone, unassigned, ambiguous)


def zone_id_for_floor(source_zone_id: str, floor_number: int) -> str:
    return f"F{floor_number}{source_zone_id[2:]}"


def numbered_stalls(
    assignments: Assignments,
    floor_number: int = SOURCE_FLOOR,
) -> tuple[list[Stall], dict[Stall, str]]:
    ordered_stalls: list[Stall] = []
    stall_ids: dict[Stall, str] = {}
    for source_zone_id in EXPECTED_ZONE_IDS:
        zone_stalls = sorted(
            assignments.unique_by_zone[source_zone_id],
            key=lambda stall: (-stall.center.y, stall.center.x, stall.handle),
        )
        target_zone_id = zone_id_for_floor(source_zone_id, floor_number)
        for sequence, stall in enumerate(zone_stalls, start=1):
            stall_ids[stall] = f"{target_zone_id}-S{sequence:03d}"
            ordered_stalls.append(stall)
    return ordered_stalls, stall_ids


def stall_label(stall: Stall) -> str:
    return f"stall #{stall.number:03d} (handle {stall.handle})"


def print_report(
    dxf_file: Path,
    stalls: list[Stall],
    assignments: Assignments,
) -> None:
    print("PARKING LAYOUT REPORT")
    print(f"DXF: {dxf_file.resolve()}")
    print("Space inspected: modelspace")
    print("Drawing units: feet")
    print()

    print("STALLS PER ZONE (uniquely assigned)")
    for zone_id in EXPECTED_ZONE_IDS:
        print(f"  {zone_id}: {len(assignments.unique_by_zone[zone_id])}")
    print(f"  Total stall polylines: {len(stalls)}")
    print(
        "  Uniquely assigned: "
        f"{sum(map(len, assignments.unique_by_zone.values()))}"
    )
    print(f"  In no zone: {len(assignments.unassigned)}")
    print(f"  In more than one zone: {len(assignments.ambiguous)}")
    print()

    print("STALLS IN NO ZONE")
    if not assignments.unassigned:
        print("  None")
    else:
        for stall in assignments.unassigned:
            print(
                f"  {stall_label(stall)}: "
                f"center=({stall.center.x:.4f}, {stall.center.y:.4f})"
            )
    print()

    print("STALLS IN MORE THAN ONE ZONE")
    if not assignments.ambiguous:
        print("  None")
    else:
        for stall, matching_zones in assignments.ambiguous:
            print(
                f"  {stall_label(stall)}: "
                f"center=({stall.center.x:.4f}, {stall.center.y:.4f}); "
                f"zones={', '.join(matching_zones)}"
            )
    print()

    print("STALL GEOMETRY")
    if not stalls:
        print("  No LWPOLYLINE entities were found on PK-STALL.")
        return

    overall_min_x = min(stall.min_x for stall in stalls)
    overall_min_y = min(stall.min_y for stall in stalls)
    overall_max_x = max(stall.max_x for stall in stalls)
    overall_max_y = max(stall.max_y for stall in stalls)
    min_width = min(stalls, key=lambda stall: stall.width)
    max_width = max(stalls, key=lambda stall: stall.width)
    min_height = min(stalls, key=lambda stall: stall.height)
    max_height = max(stalls, key=lambda stall: stall.height)
    min_area = min(stalls, key=lambda stall: stall.area)
    max_area = max(stalls, key=lambda stall: stall.area)
    mean_area = statistics.fmean(stall.area for stall in stalls)
    _, stall_ids = numbered_stalls(assignments)
    area_outliers = [
        stall
        for stall in stalls
        if abs(stall.area - mean_area) / mean_area > AREA_OUTLIER_FRACTION
    ]

    print(
        "  Overall bounding box: "
        f"min=({overall_min_x:.4f}, {overall_min_y:.4f}), "
        f"max=({overall_max_x:.4f}, {overall_max_y:.4f})"
    )
    print(
        f"  Width: min={min_width.width:.4f} [{stall_label(min_width)}], "
        f"max={max_width.width:.4f} [{stall_label(max_width)}]"
    )
    print(
        f"  Height: min={min_height.height:.4f} [{stall_label(min_height)}], "
        f"max={max_height.height:.4f} [{stall_label(max_height)}]"
    )
    print(
        f"  Area (sq ft): min={min_area.area:.2f} [{stall_label(min_area)}], "
        f"max={max_area.area:.2f} [{stall_label(max_area)}], "
        f"mean={mean_area:.2f}"
    )
    print("  Area outliers (>25% from mean):")
    if not area_outliers:
        print("    None")
    else:
        for stall in sorted(
            area_outliers,
            key=lambda item: (stall_ids.get(item, ""), item.number),
        ):
            identifier = stall_ids.get(stall, f"unassigned stall #{stall.number:03d}")
            deviation = (stall.area - mean_area) / mean_area * 100
            print(
                f"    {identifier} (handle {stall.handle}): "
                f"{stall.area:.2f} sq ft ({deviation:+.1f}%)"
            )


def registry_validation_errors(
    stalls: list[Stall], assignments: Assignments, expected_count: int
) -> list[str]:
    errors: list[str] = []
    for stall in assignments.unassigned:
        errors.append(
            f"{stall_label(stall)} at "
            f"({stall.center.x:.4f}, {stall.center.y:.4f}) is in no zone."
        )
    for stall, matching_zones in assignments.ambiguous:
        errors.append(
            f"{stall_label(stall)} at "
            f"({stall.center.x:.4f}, {stall.center.y:.4f}) is in multiple zones: "
            f"{', '.join(matching_zones)}."
        )
    if len(stalls) != expected_count:
        errors.append(
            f"Found {len(stalls)} stall polylines; expected {expected_count}. "
            "Pass --expect-count N only if the different count is intentional."
        )
    return errors


def rounded(value: float) -> float:
    result = round(value, 2)
    return 0.0 if result == 0 else result


def registry_document(
    dxf_file: Path,
    stalls: list[Stall],
    zones: dict[str, list[Vec2]],
    assignments: Assignments,
    floor_number: int,
) -> dict[str, object]:
    ordered_stalls, stall_ids = numbered_stalls(assignments, floor_number)
    # Use the source file date instead of the wall clock so unchanged input
    # produces byte-identical JSON even when regenerated on another day.
    generated_date = datetime.fromtimestamp(
        dxf_file.stat().st_mtime, tz=timezone.utc
    ).date().isoformat()

    return {
        "floor": f"F{floor_number}",
        "generated": generated_date,
        "source": dxf_file.name,
        "units": "feet",
        "bounds": {
            "minX": rounded(min(stall.min_x for stall in stalls)),
            "minY": rounded(min(stall.min_y for stall in stalls)),
            "maxX": rounded(max(stall.max_x for stall in stalls)),
            "maxY": rounded(max(stall.max_y for stall in stalls)),
        },
        "stall_count": len(stalls),
        "zones": [
            {
                "id": zone_id_for_floor(source_zone_id, floor_number),
                "stall_count": len(assignments.unique_by_zone[source_zone_id]),
                "boundary": [
                    [rounded(vertex.x), rounded(vertex.y)]
                    for vertex in zones[source_zone_id]
                ],
            }
            for source_zone_id in EXPECTED_ZONE_IDS
        ],
        "stalls": [
            {
                "id": stall_ids[stall],
                "zone": stall_ids[stall].rsplit("-S", maxsplit=1)[0],
                "x": rounded(stall.center.x),
                "y": rounded(stall.center.y),
                "width": rounded(stall.width),
                "height": rounded(stall.height),
            }
            for stall in ordered_stalls
        ],
    }


def write_json_atomically(output_file: Path, document: dict[str, object]) -> None:
    serialized = json.dumps(document, indent=2, ensure_ascii=False) + "\n"
    output_file.parent.mkdir(parents=True, exist_ok=True)
    temporary_name: str | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(
            dir=output_file.parent,
            prefix=f".{output_file.name}.",
            suffix=".tmp",
        )
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(serialized)
        os.replace(temporary_name, output_file)
        temporary_name = None
    finally:
        if temporary_name is not None:
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass


def main() -> int:
    args = parse_args()
    dxf_file = args.dxf.expanduser()

    if not dxf_file.is_file():
        print(f"DXF not found: {dxf_file}", file=sys.stderr)
        return 1

    try:
        document = ezdxf.readfile(dxf_file)
        modelspace = document.modelspace()
        stalls = read_stalls(modelspace)
        zones = read_zone_polygons(modelspace)
        assignments = assign_stalls(stalls, zones)
        print_report(dxf_file, stalls, assignments)

        if args.write_json:
            errors = registry_validation_errors(stalls, assignments, args.expect_count)
            target_floors = (
                SHARED_GEOMETRY_FLOORS
                if args.all_shared_floors
                else (args.floor,)
            )
            if errors:
                print("\nREGISTRY VALIDATION FAILED", file=sys.stderr)
                for error in errors:
                    print(f"  - {error}", file=sys.stderr)
                for floor_number in target_floors:
                    print(
                        f"Registry was not modified: {registry_path(floor_number)}",
                        file=sys.stderr,
                    )
                return 1

            registries = [
                (
                    registry_path(floor_number),
                    registry_document(
                        dxf_file,
                        stalls,
                        zones,
                        assignments,
                        floor_number,
                    ),
                )
                for floor_number in target_floors
            ]
            for output_file, registry in registries:
                write_json_atomically(output_file, registry)
                print(f"\nRegistry written: {output_file}")
    except (OSError, DXFStructureError, ValueError) as error:
        print(f"Unable to create report: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
