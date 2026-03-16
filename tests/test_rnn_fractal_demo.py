from pathlib import Path

from typer.testing import CliRunner

import blog.scripts.rnn_fractal_demo as demo

BLOG_IMAGE_DIR = Path("blog/15-03-2026-ai-and-the-old-gods/images/rnn-fractal-demo")


def test_language_validators() -> None:
    assert demo.is_anbn("aaabbb")
    assert not demo.is_anbn("aabbb")
    assert demo.is_dyck1("(())()")
    assert not demo.is_dyck1("(()")
    assert not demo.is_odd_parity("101")
    assert demo.is_odd_parity("1011")


def test_symbolic_dust_shape() -> None:
    points = demo.symbolic_dust(depth=4, digits=(0, 2), base=3)
    assert points.shape[1] == 2
    assert points.shape[0] == 16 * 16


def test_encode_batch_shapes() -> None:
    vocab = demo.build_vocab("ab")
    tokens, lengths = demo.encode_batch(["ab", "aabb"], vocab)
    assert tokens.shape[0] == 2
    assert lengths.tolist() == [3, 5]


def test_dust_cli_writes_file(tmp_path: Path) -> None:
    runner = CliRunner()
    result = runner.invoke(
        demo.app,
        [
            "dust",
            "--output-dir",
            str(tmp_path),
            "--depth",
            "4",
            "--points",
            "128",
            "--base",
            "3",
            "--digits",
            "0,2",
        ],
    )
    assert result.exit_code == 0, result.output
    assert any(path.suffix == ".png" for path in tmp_path.iterdir())


def test_train_cli_smoke(tmp_path: Path) -> None:
    runner = CliRunner()
    result = runner.invoke(
        demo.app,
        [
            "train",
            "--language",
            "odd_parity",
            "--output-dir",
            str(tmp_path),
            "--train-samples",
            "80",
            "--short-test-samples",
            "40",
            "--long-test-samples",
            "40",
            "--min-complexity",
            "1",
            "--max-complexity",
            "5",
            "--short-test-min-complexity",
            "1",
            "--short-test-complexity",
            "6",
            "--long-test-min-complexity",
            "7",
            "--long-test-complexity",
            "9",
            "--epochs",
            "1",
            "--batch-size",
            "16",
            "--trace-variants",
            "2",
            "--trace-output-dir",
            str(tmp_path / "trace-clouds"),
        ],
    )
    assert result.exit_code == 0, result.output
    assert (tmp_path / "odd_parity-training-curves.png").exists()
    assert (tmp_path / "run-metadata.json").exists()
    assert (tmp_path / "trace-clouds" / "odd_parity-trace-cloud-01.png").exists()
    assert (tmp_path / "trace-clouds" / "odd_parity-trace-cloud-02.png").exists()


def test_generate_blog_artifacts_for_one_language() -> None:
    BLOG_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    runner = CliRunner()

    dust = runner.invoke(
        demo.app,
        [
            "dust",
            "--output-dir",
            str(BLOG_IMAGE_DIR),
            "--depth",
            "10",
            "--points",
            "1000",
            "--base",
            "3",
            "--digits",
            "0,2",
            "--title",
            "Cantor-style symbolic dust",
        ],
    )
    assert dust.exit_code == 0, dust.output

    train = runner.invoke(
        demo.app,
        [
            "train",
            "--language",
            "dyck1",
            "--output-dir",
            str(BLOG_IMAGE_DIR),
            "--train-samples",
            "1800",
            "--short-test-samples",
            "500",
            "--long-test-samples",
            "500",
            "--min-complexity",
            "1",
            "--max-complexity",
            "20",
            "--short-test-min-complexity",
            "1",
            "--short-test-complexity",
            "20",
            "--long-test-min-complexity",
            "21",
            "--long-test-complexity",
            "60",
            "--epochs",
            "80",
            "--batch-size",
            "64",
            "--lr",
            "0.003",
            "--seed",
            "7",
            "--trace-variants",
            "1",
            "--trace-output-dir",
            str(BLOG_IMAGE_DIR),
        ],
    )
    assert train.exit_code == 0, train.output

    expected = [
        BLOG_IMAGE_DIR / "dust-depth10-base3-digits02-layered-basepts64.png",
        BLOG_IMAGE_DIR / "dyck1-training-curves.png",
        BLOG_IMAGE_DIR / "dyck1-dataset-distribution.png",
        BLOG_IMAGE_DIR / "dyck1-trace-cloud-01.png",
        BLOG_IMAGE_DIR / "dyck1-run-metadata.json",
        BLOG_IMAGE_DIR / "run-metadata.json",
    ]
    for path in expected:
        assert path.exists(), f"missing artifact: {path}"
        assert path.stat().st_size > 0, f"empty artifact: {path}"
