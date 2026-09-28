"""Report on a parking DXF and optionally build floor stall registries."""

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


STALL_LAYER = "PK-STALL"
FEATURE_LAYER_SPECS = (
    ("deck", "PK-DECK"),
    ("wall", "PK-WALL"),
    ("column", "PK-COLUMN"),
    ("ramp", "PK-RAMP"),
    ("vertical", "PK-VERTICAL"),
    ("marking", "PK-MARKING"),
)
SUPPORTED_FEATURE_ENTITY_TYPES = frozenset(
    {"LWPOLYLINE", "POLYLINE", "LINE", "ARC", "CIRCLE", "SOLID"}
)
ZONE_LAYER_PATTERN = re.compile(
    r"^F(?P<floor>\d+)-Z(?P<zone>\d+)$",
    re.IGNORECASE,
)
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


@dataclass(frozen=True)
class ZoneDefinition:
    number: int
    layer_name: str


@dataclass(frozen=True)
class ZoneConfiguration:
    source_floor: int
    zones: tuple[ZoneDefinition, ...]
    warnings: tuple[str, ...]


@dataclass
class Assignments:
    unique_by_zone: dict[int, list[Stall]]
    unassigned: list[Stall]
    ambiguous: list[tuple[Stall, list[int]]]


@dataclass(frozen=True)
class FeatureShape:
    vertices: tuple[Vec2, ...]
    closed: bool


@dataclass
class FeatureData:
    shapes: dict[str, list[FeatureShape]]
    warnings: list[str]


def load_ezdxf() -> None:
    global ezdxf, bbox, ezdxf_path, DXFStructureError, Vec2
    global is_point_in_polygon_2d

    try:
        import ezdxf as ezdxf_module
        from ezdxf import bbox as bbox_module
        from ezdxf import path as path_module
        from ezdxf.lldxf.const import DXFStructureError as structure_error
        from ezdxf.math import Vec2 as vector_2d
        from ezdxf.math import is_point_in_polygon_2d as point_in_polygon
    except ModuleNotFoundError:
        print(
            "Missing dependency: ezdxf. Install it with: "
            "python -m pip install ezdxf",
            file=sys.stderr,
        )
        raise SystemExit(2)

    ezdxf = ezdxf_module
    bbox = bbox_module
    ezdxf_path = path_module
    DXFStructureError = structure_error
    Vec2 = vector_2d
    is_point_in_polygon_2d = point_in_polygon


def positive_integer(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("expected a positive integer")
    return parsed


def default_directories() -> tuple[Path, Path]:
    repo_root = Path(__file__).resolve().parent.parent
    return repo_root / "private", repo_root / "data" / "garage"


def parse_args() -> argparse.Namespace:
    default_dxf_dir, default_out_dir = default_directories()
    parser = argparse.ArgumentParser(
        description=(
            "Print stall counts, discovered zone assignments, and geometry ranges "
            "from a DXF; optionally write validated floor registries."
        ),
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "dxf",
        help=(
            "DXF path; a bare filename is looked up in --dxf-dir, while paths "
            "with a directory component are resolved from the current directory"
        ),
    )
    parser.add_argument(
        "--dxf-dir",
        type=Path,
        default=default_dxf_dir,
        help="default directory used for a bare DXF filename",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=default_out_dir,
        help="directory for generated floor-N.json registries",
    )
    parser.add_argument(
        "--write-json",
        action="store_true",
        help="write registries after every validation gate passes",
    )
    parser.add_argument(
        "--expect-count",
        type=positive_integer,
        default=DEFAULT_EXPECTED_STALL_COUNT,
        metavar="N",
        help="required stall count when writing JSON",
    )
    parser.add_argument(
        "--floors",
        type=positive_integer,
        nargs="+",
        default=[2, 3, 4, 5],
        metavar="N",
        help="target floor numbers for registry IDs and filenames",
    )
    return parser.parse_args()


def resolve_directory(path: Path) -> Path:
    return path.expanduser().resolve()


def resolve_dxf_path(value: str, dxf_directory: Path) -> Path:
    supplied = Path(value).expanduser()
    is_bare_filename = not supplied.is_absolute() and supplied.name == value
    if is_bare_filename:
        return (dxf_directory / supplied).resolve()
    return supplied.resolve()


def registry_path(output_directory: Path, floor_number: int) -> Path:
    return output_directory / f"floor-{floor_number}.json"


def zone_id(floor_number: int, zone_number: int) -> str:
    return f"F{floor_number}-Z{zone_number:02d}"


def entity_handle(entity: object) -> str:
    handle = getattr(getattr(entity, "dxf", None), "handle", None)
    return str(handle) if handle else "unknown"


def discover_zone_configuration(document: object) -> ZoneConfiguration:
    discovered: list[tuple[int, int, str]] = []
    for layer in document.layers:
        layer_name = str(layer.dxf.name)
        match = ZONE_LAYER_PATTERN.fullmatch(layer_name)
        if match:
            discovered.append(
                (
                    int(match.group("floor")),
                    int(match.group("zone")),
                    layer_name,
                )
            )

    if not discovered:
        raise ValueError(
            "No zone layers matching F<digits>-Z<digits> were found in the drawing."
        )

    floors = sorted({floor_number for floor_number, _, _ in discovered})
    if len(floors) != 1:
        formatted = ", ".join(f"F{floor_number}" for floor_number in floors)
        raise ValueError(
            "Zone layers for more than one source floor were found: " + formatted
        )

    source_floor = floors[0]
    by_number: dict[int, list[str]] = {}
    for _, zone_number, layer_name in discovered:
        by_number.setdefault(zone_number, []).append(layer_name)

    duplicates = {
        number: names for number, names in by_number.items() if len(names) > 1
    }
    if duplicates:
        details = "; ".join(
            f"zone {number}: {', '.join(sorted(names))}"
            for number, names in sorted(duplicates.items())
        )
        raise ValueError("Multiple layer names resolve to the same zone number: " + details)

    zones = tuple(
        ZoneDefinition(number, names[0])
        for number, names in sorted(by_number.items())
    )
    warnings: list[str] = []
    zone_numbers = {zone.number for zone in zones}
    if 0 in zone_numbers:
        warnings.append("Zone numbering should start at 1, but zone 0 was found.")
    positive_numbers = {number for number in zone_numbers if number >= 1}
    if positive_numbers:
        missing = sorted(set(range(1, max(positive_numbers) + 1)) - positive_numbers)
        if missing:
            formatted = ", ".join(f"Z{number:02d}" for number in missing)
            warnings.append(
                "Zone numbering is not contiguous from 1; missing: " + formatted
            )
    elif 0 not in zone_numbers:
        warnings.append("No positive zone numbers were found.")

    return ZoneConfiguration(source_floor, zones, tuple(warnings))


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


def feature_shape(entity: object) -> FeatureShape:
    feature_path = ezdxf_path.make_path(entity)
    closed = bool(feature_path.is_closed)
    vertices = [
        Vec2(vertex.x, vertex.y)
        for vertex in feature_path.flattening(
            distance=CURVE_FLATTENING_TOLERANCE_FEET
        )
    ]
    if len(vertices) > 1:
        first = vertices[0]
        last = vertices[-1]
        if math.isclose(first.x, last.x, abs_tol=1e-9) and math.isclose(
            first.y, last.y, abs_tol=1e-9
        ):
            vertices.pop()

    minimum_vertices = 3 if closed else 2
    if len(vertices) < minimum_vertices:
        raise ValueError(
            f"requires at least {minimum_vertices} vertices after flattening"
        )
    return FeatureShape(tuple(vertices), closed)


def read_features(modelspace: object) -> FeatureData:
    layer_to_key = {
        layer_name.casefold(): feature_key
        for feature_key, layer_name in FEATURE_LAYER_SPECS
    }
    shapes: dict[str, list[FeatureShape]] = {
        feature_key: [] for feature_key, _ in FEATURE_LAYER_SPECS
    }
    unsupported: dict[str, dict[str, int]] = {
        feature_key: {} for feature_key, _ in FEATURE_LAYER_SPECS
    }
    warnings: list[str] = []

    for entity in modelspace:
        feature_key = layer_to_key.get(entity.dxf.layer.casefold())
        if feature_key is None:
            continue

        entity_type = entity.dxftype()
        if entity_type not in SUPPORTED_FEATURE_ENTITY_TYPES:
            counts = unsupported[feature_key]
            counts[entity_type] = counts.get(entity_type, 0) + 1
            continue

        try:
            shapes[feature_key].append(feature_shape(entity))
        except (TypeError, ValueError) as error:
            warnings.append(
                f"{entity.dxf.layer} handle {entity_handle(entity)} "
                f"({entity_type}) was skipped: {error}"
            )

    for feature_key, layer_name in FEATURE_LAYER_SPECS:
        unsupported_counts = unsupported[feature_key]
        if unsupported_counts:
            details = ", ".join(
                f"{entity_type}={count}"
                for entity_type, count in sorted(unsupported_counts.items())
            )
            warnings.append(f"{layer_name} ignored unsupported entities: {details}")

    return FeatureData(shapes, warnings)


def read_zone_polygons(
    modelspace: object,
    configuration: ZoneConfiguration,
) -> dict[int, list[Vec2]]:
    zone_layer_names = {
        zone.layer_name.casefold(): zone.number for zone in configuration.zones
    }
    zone_entities: dict[int, list[object]] = {
        zone.number: [] for zone in configuration.zones
    }
    for entity in modelspace:
        zone_number = zone_layer_names.get(entity.dxf.layer.casefold())
        if zone_number is not None and entity.dxftype() == "LWPOLYLINE":
            zone_entities[zone_number].append(entity)

    errors: list[str] = []
    polygons: dict[int, list[Vec2]] = {}
    for zone in configuration.zones:
        entities = zone_entities[zone.number]
        if len(entities) != 1:
            errors.append(
                f"Layer {zone.layer_name} has {len(entities)} LWPOLYLINE entities; "
                "expected exactly 1."
            )
            continue

        boundary = entities[0]
        if not boundary.closed:
            errors.append(
                f"Layer {zone.layer_name} boundary "
                f"(handle {entity_handle(boundary)}) is not closed."
            )
            continue

        try:
            polygons[zone.number] = boundary_polygon(boundary)
        except ValueError as error:
            errors.append(f"Layer {zone.layer_name}: {error}")

    if errors:
        raise ValueError("Invalid zone geometry:\n  - " + "\n  - ".join(errors))
    return polygons


def assign_stalls(
    stalls: list[Stall],
    zones: dict[int, list[Vec2]],
) -> Assignments:
    unique_by_zone: dict[int, list[Stall]] = {
        zone_number: [] for zone_number in zones
    }
    unassigned: list[Stall] = []
    ambiguous: list[tuple[Stall, list[int]]] = []

    for stall in stalls:
        matching_zones = [
            zone_number
            for zone_number, polygon in zones.items()
            if is_point_in_polygon_2d(stall.center, polygon) >= 0
        ]
        if len(matching_zones) == 1:
            unique_by_zone[matching_zones[0]].append(stall)
        elif not matching_zones:
            unassigned.append(stall)
        else:
            ambiguous.append((stall, matching_zones))

    return Assignments(unique_by_zone, unassigned, ambiguous)


def numbered_stalls(
    assignments: Assignments,
    configuration: ZoneConfiguration,
    floor_number: int,
) -> tuple[list[Stall], dict[Stall, str]]:
    ordered_stalls: list[Stall] = []
    stall_ids: dict[Stall, str] = {}
    for zone in configuration.zones:
        zone_stalls = sorted(
            assignments.unique_by_zone[zone.number],
            key=lambda stall: (-stall.center.y, stall.center.x, stall.handle),
        )
        target_zone_id = zone_id(floor_number, zone.number)
        for sequence, stall in enumerate(zone_stalls, start=1):
            stall_ids[stall] = f"{target_zone_id}-S{sequence:03d}"
            ordered_stalls.append(stall)
    return ordered_stalls, stall_ids


def stall_label(stall: Stall) -> str:
    return f"stall #{stall.number:03d} (handle {stall.handle})"


def overall_bounds(
    stalls: list[Stall],
    features: FeatureData,
) -> tuple[float, float, float, float]:
    min_x_values = [stall.min_x for stall in stalls]
    min_y_values = [stall.min_y for stall in stalls]
    max_x_values = [stall.max_x for stall in stalls]
    max_y_values = [stall.max_y for stall in stalls]

    for feature_shapes in features.shapes.values():
        for shape in feature_shapes:
            min_x_values.extend(vertex.x for vertex in shape.vertices)
            min_y_values.extend(vertex.y for vertex in shape.vertices)
            max_x_values.extend(vertex.x for vertex in shape.vertices)
            max_y_values.extend(vertex.y for vertex in shape.vertices)

    if not min_x_values:
        raise ValueError("No stall or feature geometry was found for bounds.")
    return (
        min(min_x_values),
        min(min_y_values),
        max(max_x_values),
        max(max_y_values),
    )


def print_report(
    stalls: list[Stall],
    assignments: Assignments,
    configuration: ZoneConfiguration,
    features: FeatureData,
) -> None:
    print("Space inspected: modelspace")
    print("Drawing units: feet")
    print()

    print("STALLS PER ZONE (uniquely assigned)")
    for zone in configuration.zones:
        identifier = zone_id(configuration.source_floor, zone.number)
        print(f"  {identifier}: {len(assignments.unique_by_zone[zone.number])}")
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
            identifiers = [
                zone_id(configuration.source_floor, number)
                for number in matching_zones
            ]
            print(
                f"  {stall_label(stall)}: "
                f"center=({stall.center.x:.4f}, {stall.center.y:.4f}); "
                f"zones={', '.join(identifiers)}"
            )
    print()

    print("BUILDING FEATURES")
    for feature_key, layer_name in FEATURE_LAYER_SPECS:
        shape_count = len(features.shapes[feature_key])
        warning = " [WARNING: empty]" if shape_count == 0 else ""
        print(
            f"  {layer_name} ({feature_key}): {shape_count} shapes{warning}"
        )
    if features.warnings:
        print("  Feature warnings:")
        for warning in features.warnings:
            print(f"    WARNING: {warning}")
    print()

    print("STALL GEOMETRY")
    if not stalls:
        print("  No LWPOLYLINE entities were found on PK-STALL.")
        return

    overall_min_x, overall_min_y, overall_max_x, overall_max_y = overall_bounds(
        stalls,
        features,
    )
    min_width = min(stalls, key=lambda stall: stall.width)
    max_width = max(stalls, key=lambda stall: stall.width)
    min_height = min(stalls, key=lambda stall: stall.height)
    max_height = max(stalls, key=lambda stall: stall.height)
    min_area = min(stalls, key=lambda stall: stall.area)
    max_area = max(stalls, key=lambda stall: stall.area)
    mean_area = statistics.fmean(stall.area for stall in stalls)
    _, stall_ids = numbered_stalls(
        assignments,
        configuration,
        configuration.source_floor,
    )
    area_outliers = [
        stall
        for stall in stalls
        if abs(stall.area - mean_area) / mean_area > AREA_OUTLIER_FRACTION
    ]

    print(
        "  Overall bounding box (stalls + features): "
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
    stalls: list[Stall],
    assignments: Assignments,
    configuration: ZoneConfiguration,
    expected_count: int,
) -> list[str]:
    errors: list[str] = []
    for stall in assignments.unassigned:
        errors.append(
            f"{stall_label(stall)} at "
            f"({stall.center.x:.4f}, {stall.center.y:.4f}) is in no zone."
        )
    for stall, matching_zones in assignments.ambiguous:
        identifiers = [
            zone_id(configuration.source_floor, number)
            for number in matching_zones
        ]
        errors.append(
            f"{stall_label(stall)} at "
            f"({stall.center.x:.4f}, {stall.center.y:.4f}) is in multiple zones: "
            f"{', '.join(identifiers)}."
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
    zones: dict[int, list[Vec2]],
    assignments: Assignments,
    configuration: ZoneConfiguration,
    features: FeatureData,
    floor_number: int,
) -> dict[str, object]:
    ordered_stalls, stall_ids = numbered_stalls(
        assignments,
        configuration,
        floor_number,
    )
    generated_date = datetime.fromtimestamp(
        dxf_file.stat().st_mtime,
        tz=timezone.utc,
    ).date().isoformat()
    min_x, min_y, max_x, max_y = overall_bounds(stalls, features)

    return {
        "floor": f"F{floor_number}",
        "generated": generated_date,
        "source": dxf_file.name,
        "units": "feet",
        "bounds": {
            "minX": rounded(min_x),
            "minY": rounded(min_y),
            "maxX": rounded(max_x),
            "maxY": rounded(max_y),
        },
        "stall_count": len(stalls),
        "zones": [
            {
                "id": zone_id(floor_number, zone.number),
                "stall_count": len(assignments.unique_by_zone[zone.number]),
                "boundary": [
                    [rounded(vertex.x), rounded(vertex.y)]
                    for vertex in zones[zone.number]
                ],
            }
            for zone in configuration.zones
        ],
        "features": {
            feature_key: [
                {
                    "closed": shape.closed,
                    "vertices": [
                        [rounded(vertex.x), rounded(vertex.y)]
                        for vertex in shape.vertices
                    ],
                }
                for shape in features.shapes[feature_key]
            ]
            for feature_key, _ in FEATURE_LAYER_SPECS
        },
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
    dxf_directory = resolve_directory(args.dxf_dir)
    output_directory = resolve_directory(args.out_dir)
    dxf_file = resolve_dxf_path(args.dxf, dxf_directory)
    target_floors = tuple(dict.fromkeys(args.floors))

    print("PARKING LAYOUT REPORT")
    print(f"DXF: {dxf_file}")
    print(f"Output directory: {output_directory}", flush=True)

    if not dxf_file.is_file():
        print(f"DXF not found: {dxf_file}", file=sys.stderr)
        return 1

    load_ezdxf()
    try:
        document = ezdxf.readfile(dxf_file)
        modelspace = document.modelspace()
        configuration = discover_zone_configuration(document)
        print(f"Source floor: F{configuration.source_floor}")
        if configuration.warnings:
            print()
            print("WARNINGS")
            for warning in configuration.warnings:
                print(f"  WARNING: {warning}")
        print(flush=True)
        stalls = read_stalls(modelspace)
        zones = read_zone_polygons(modelspace, configuration)
        assignments = assign_stalls(stalls, zones)
        features = read_features(modelspace)
        print_report(stalls, assignments, configuration, features)

        if args.write_json:
            errors = registry_validation_errors(
                stalls,
                assignments,
                configuration,
                args.expect_count,
            )
            if errors:
                print("\nREGISTRY VALIDATION FAILED", file=sys.stderr)
                for error in errors:
                    print(f"  - {error}", file=sys.stderr)
                for floor_number in target_floors:
                    print(
                        "Registry was not modified: "
                        f"{registry_path(output_directory, floor_number)}",
                        file=sys.stderr,
                    )
                return 1

            registries = [
                (
                    registry_path(output_directory, floor_number),
                    registry_document(
                        dxf_file,
                        stalls,
                        zones,
                        assignments,
                        configuration,
                        features,
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
