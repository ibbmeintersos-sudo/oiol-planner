import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "acquire-real-world-snapshot.py"
SPEC = importlib.util.spec_from_file_location("p12_snapshot_acquirer", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SnapshotAcquisitionSafetyTests(unittest.TestCase):
    def test_fingerprint_uses_sorted_paths_and_nul_separators(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "a.txt").write_bytes(b"x")
            expected = hashlib.sha256()
            expected.update(b"a.txt")
            expected.update(bytes([0]))
            expected.update(b"x")
            expected.update(bytes([0]))
            self.assertEqual(MODULE.fingerprint(root)["sha256"], expected.hexdigest())

    def test_accepts_existing_regular_license_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "LICENSE").write_text("license", encoding="utf-8")
            self.assertEqual(MODULE.resolve_license_file(root, "LICENSE"), root / "LICENSE")

    def test_rejects_parent_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):
                MODULE.resolve_license_file(Path(temp), "../outside")

    def test_rejects_absolute_path(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):
                MODULE.resolve_license_file(Path(temp), "/etc/passwd")

    def test_rejects_symlink_component(self):
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as outside:
            root = Path(temp)
            (Path(outside) / "LICENSE").write_text("outside", encoding="utf-8")
            (root / "linked").symlink_to(Path(outside), target_is_directory=True)
            with self.assertRaises(ValueError):
                MODULE.resolve_license_file(root, "linked/LICENSE")


if __name__ == "__main__":
    unittest.main()
