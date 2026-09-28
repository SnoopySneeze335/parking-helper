"""Render a generated floor registry as a simple verification PNG."""

from __future__ import annotations

import argparse
import json
import logging
import sys
import warnings
from pathlib import Path


def positive_integer(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("expected a positive integer")
    return parsed


def default_directories() -> tuple[Path, Path]:
    repo_root = Path(__file__).resolve().parent.parent
    return repo_root / "data" / "garage", repo_root / "private"


def parse_args() -> argparse.Namespace:
    default_registry_dir, default_out_dir = default_directories()
    parser = argparse.ArgumentParser(
        description="Render a floor-N.json stall registry as a verification PNG.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "floor",
        type=positive_integer,
        help="floor number used to select floor-N.json and name the preview",
    )
    parser.add_argument(
        "--registry-dir",
        type=Path,
        default=default_registry_dir,
        help="directory containing floor-N.json registries",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=default_out_dir,
        help="directory for floor-N-preview.png",
    )
    return parser.parse_args()


def resolve_directory(path: Path) -> Path:
    return path.expanduser().resolve()


def load_plotting_modules() -> tuple[object, object, object]:
    # Some malformed system fonts trigger irrelevant fontTools logging and
    # warnings while matplotlib builds its font cache. Suppress only that noise.
    logging.getLogger("fontTools").setLevel(logging.ERROR)
    warnings.filterwarnings(
        "ignore",
        message=r".*'name' table stringOffset incorrect.*",
    )
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.patches import Polygon, Rectangle
    except ModuleNotFoundError:
        print(
            "Missing dependency: matplotlib. Install it with: "
            "python -m pip install matplotlib",
            file=sys.stderr,
        )
        raise SystemExit(2)
    return plt, Rectangle, Polygon


def draw_feature_shape(
    axes: object,
    shape: dict[str, object],
    polygon_patch: object,
    *,
    color: str,
    linewidth: float,
    zorder: float,
    fill: bool,
    alpha: float = 1.0,
) -> None:
    vertices = shape["vertices"]
    if len(vertices) < 2:
        return
    closed = bool(shape["closed"])

    if fill and closed and len(vertices) >= 3:
        axes.add_patch(
            polygon_patch(
                vertices,
                closed=True,
                facecolor=color,
                edgecolor=color,
                linewidth=linewidth,
                alpha=alpha,
                zorder=zorder,
            )
        )
        return

    plotted_vertices = vertices + [vertices[0]] if closed else vertices
    axes.plot(
        [point[0] for point in plotted_vertices],
        [point[1] for point in plotted_vertices],
        color=color,
        linewidth=linewidth,
        alpha=alpha,
        zorder=zorder,
    )


def draw_features(
    axes: object,
    features: dict[str, list[dict[str, object]]],
    polygon_patch: object,
) -> None:
    styles = {
        "deck": {
            "color": "#374151",
            "linewidth": 1.5,
            "zorder": 0.1,
            "fill": False,
        },
        "ramp": {
            "color": "#d1d5db",
            "linewidth": 0.8,
            "zorder": 0.2,
            "fill": True,
            "alpha": 0.8,
        },
        "vertical": {
            "color": "#d1d5db",
            "linewidth": 0.8,
            "zorder": 0.3,
            "fill": True,
            "alpha": 0.8,
        },
        "column": {
            "color": "#6b7280",
            "linewidth": 0.7,
            "zorder": 0.4,
            "fill": True,
            "alpha": 0.9,
        },
        "wall": {
            "color": "#111827",
            "linewidth": 1.0,
            "zorder": 0.7,
            "fill": False,
        },
        "marking": {
            "color": "#9ca3af",
            "linewidth": 0.45,
            "zorder": 0.8,
            "fill": False,
        },
    }
    for feature_key, style in styles.items():
        for shape in features.get(feature_key, []):
            draw_feature_shape(axes, shape, polygon_patch, **style)


def main() -> int:
    args = parse_args()
    registry_directory = resolve_directory(args.registry_dir)
    output_directory = resolve_directory(args.out_dir)
    registry_path = registry_directory / f"floor-{args.floor}.json"
    preview_path = output_directory / f"floor-{args.floor}-preview.png"

    print(f"Registry: {registry_path}")
    print(f"Preview: {preview_path}")

    if not registry_path.is_file():
        print(f"Registry not found: {registry_path}", file=sys.stderr)
        return 1

    try:
        with registry_path.open("r", encoding="utf-8") as stream:
            registry = json.load(stream)
    except (OSError, json.JSONDecodeError) as error:
        print(f"Unable to read registry: {error}", file=sys.stderr)
        return 1

    expected_floor = f"F{args.floor}"
    if registry.get("floor") != expected_floor:
        print(
            f"Registry floor is {registry.get('floor')!r}; expected {expected_floor!r}.",
            file=sys.stderr,
        )
        return 1

    plt, Rectangle, Polygon = load_plotting_modules()

    try:
        bounds = registry["bounds"]
        drawing_width = bounds["maxX"] - bounds["minX"]
        drawing_height = bounds["maxY"] - bounds["minY"]
        aspect = drawing_width / drawing_height if drawing_height else 1
        figure_width = 16
        figure_height = min(16, max(6, figure_width / aspect))
        figure, axes = plt.subplots(figsize=(figure_width, figure_height))

        draw_features(axes, registry.get("features", {}), Polygon)

        zone_colors = plt.get_cmap("tab10")
        for zone_index, zone in enumerate(registry["zones"]):
            boundary = zone["boundary"]
            if not boundary:
                continue
            closed_boundary = boundary + [boundary[0]]
            xs = [point[0] for point in closed_boundary]
            ys = [point[1] for point in closed_boundary]
            color = zone_colors(zone_index % 10)
            axes.plot(xs, ys, color=color, linewidth=1.6, zorder=3)
            label_x = sum(point[0] for point in boundary) / len(boundary)
            label_y = sum(point[1] for point in boundary) / len(boundary)
            axes.text(
                label_x,
                label_y,
                zone["id"],
                color=color,
                fontsize=7,
                fontweight="bold",
                ha="center",
                va="center",
                bbox={"facecolor": "white", "edgecolor": "none", "alpha": 0.75},
                zorder=5,
            )

        for stall in registry["stalls"]:
            left = stall["x"] - stall["width"] / 2
            bottom = stall["y"] - stall["height"] / 2
            axes.add_patch(
                Rectangle(
                    (left, bottom),
                    stall["width"],
                    stall["height"],
                    facecolor="#f4f5f7",
                    edgecolor="#4b5563",
                    linewidth=0.45,
                    zorder=1,
                )
            )
            stall_number = stall["id"].rsplit("-S", maxsplit=1)[1]
            axes.text(
                stall["x"],
                stall["y"],
                stall_number,
                fontsize=2.8,
                ha="center",
                va="center",
                color="#111827",
                zorder=2,
            )

        padding = max(drawing_width, drawing_height) * 0.025
        axes.set_xlim(bounds["minX"] - padding, bounds["maxX"] + padding)
        axes.set_ylim(bounds["minY"] - padding, bounds["maxY"] + padding)
        axes.set_aspect("equal", adjustable="box")
        axes.set_title(
            f"{registry['floor']} parking registry — "
            f"{registry['stall_count']} stalls"
        )
        axes.set_xlabel(f"X ({registry['units']})")
        axes.set_ylabel(f"Y ({registry['units']})")
        axes.grid(visible=True, linewidth=0.25, alpha=0.3)
        figure.tight_layout()
    except (KeyError, TypeError, ValueError) as error:
        print(f"Invalid registry structure: {error}", file=sys.stderr)
        return 1

    output_directory.mkdir(parents=True, exist_ok=True)
    figure.savefig(preview_path, dpi=200, bbox_inches="tight")
    plt.close(figure)
    print(f"Preview written: {preview_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
