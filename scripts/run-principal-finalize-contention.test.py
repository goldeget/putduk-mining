#!/usr/bin/env python3
"""Pure rejection tests. No database, Docker, CI, or finance is executed."""
from copy import deepcopy
from pathlib import Path
import importlib.util
import tempfile
import unittest

path = Path(__file__).with_name("run-principal-finalize-contention.py")
spec = importlib.util.spec_from_file_location("principal_native152", path)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class WholeProofRejectionTests(unittest.TestCase):
    def setUp(self):
        # Deliberately synthetic metadata for the pure input validator only.
        # None of these values represents an actual accepted DB generation.
        self.sources = {f"supabase/migrations/{index:014}_test.sql": "0" * 64
                        for index in range(152)}
        appended = sorted(self.sources)[-32:]
        self.proof = {
            "accepted": True, "migration_count": 152, "definer_count": 29,
            "gates": {name: {"exit_code": 0} for name in
                      ("fresh_reset", "whole_sql", "db_lint", "db_advisors")},
            "source_inputs": deepcopy(self.sources),
            "baseline_identity": "152\n" + "\n".join(["0" * 32] * 9),
            "staged139": {"accepted": True, "all_cases_and_restoration_proven": True,
                          "case_counts": dict(runner.COUNTS),
                          "native_assertions": 120, "canonical_assertions": 1940,
                          "appended_migration_sources":
                              {name: self.sources[name] for name in appended}},
        }
        self.proof["gates"]["whole_sql"].update(
            assertions=4073, files=70, failed=0, skipped=0, todo=0)

    def denied(self, code):
        with self.assertRaisesRegex(RuntimeError, code):
            runner.verify_whole_proof(self.proof, self.sources)

    def test_old120_cannot_authorize152_even_with_claimed_green_gates(self):
        self.proof["migration_count"] = 120
        self.denied("ACCEPTED_WHOLE152_PREREQUISITE_REQUIRED")

    def test_unaccepted_whole_generation_is_rejected(self):
        self.proof["accepted"] = False
        self.denied("ACCEPTED_WHOLE152_PREREQUISITE_REQUIRED")

    def test_changed_definer_inventory_is_rejected(self):
        self.proof["definer_count"] = 30
        self.denied("ACCEPTED_WHOLE152_PREREQUISITE_REQUIRED")

    def test_missing_advisor_gate_is_rejected(self):
        del self.proof["gates"]["db_advisors"]
        self.denied("COMPLETE_WHOLE152_GATES_REQUIRED")

    def test_boolean_false_is_not_a_real_zero_exit_code(self):
        self.proof["gates"]["whole_sql"]["exit_code"] = False
        self.denied("COMPLETE_WHOLE152_GATES_REQUIRED")

    def test_skipped_or_todo_sql_cannot_be_accepted(self):
        for field in ("skipped", "todo"):
            with self.subTest(field=field):
                self.proof["gates"]["whole_sql"][field] = 1
                self.denied("ACTUAL4073_WITHOUT_SKIPS_REQUIRED")
                self.proof["gates"]["whole_sql"][field] = 0

    def test_prior_sql_total_cannot_stand_in_for_current_suite(self):
        self.proof["gates"]["whole_sql"]["assertions"] = 4072
        self.denied("ACTUAL4073_WITHOUT_SKIPS_REQUIRED")

    def test_source_drift_is_rejected(self):
        self.proof["source_inputs"][next(iter(self.sources))] = "1" * 64
        self.denied("WHOLE152_EXACT_SOURCE_BINDING_REQUIRED")

    def test_one_failed_staged_native_case_blocks_execution(self):
        self.proof["staged139"]["all_cases_and_restoration_proven"] = False
        self.denied("ACCEPTED_SAME_SOURCE_ALL139_CASES_REQUIRED")

    def test_old_append_source_cannot_authorize_new_economic_definitions(self):
        self.proof["staged139"]["appended_migration_sources"][sorted(self.sources)[-1]] = "1" * 64
        self.denied("ACCEPTED_SAME_SOURCE_ALL139_CASES_REQUIRED")

    def test_missing_rls_policy_fingerprint_is_rejected(self):
        self.proof["baseline_identity"] = "152\n" + "\n".join(["0" * 32] * 8)
        self.denied("WHOLE152_SECURITY_IDENTITY_REQUIRED")

    def test_actual_database_subdirectory_is_in_the_source_binding(self):
        original_root = runner.ROOT
        original_sql_inputs = runner.SQL_INPUTS
        original_module_file = runner.__file__
        try:
            with tempfile.TemporaryDirectory(prefix="guard-sources-", dir=path.parents[2]) as temporary:
                runner.ROOT = Path(temporary)
                runner.SQL_INPUTS = {}
                migrations = runner.ROOT / "supabase/migrations"
                tests = runner.ROOT / "supabase/tests/database"
                migrations.mkdir(parents=True)
                tests.mkdir(parents=True)
                for index in range(152):
                    (migrations / f"{index:014}_fixture.sql").write_text("-- pure source fixture")
                for index in range(70):
                    (tests / f"{index}_fixture.sql").write_text("-- pure source fixture")
                (runner.ROOT / "scripts").mkdir()
                fixture_caller = runner.ROOT / "scripts/run-principal-finalize-contention.py"
                fixture_caller.write_text("# pure fixture")
                runner.__file__ = str(fixture_caller)
                (runner.ROOT / "scripts/capture-local-supabase-env.mjs").write_text("// fixture")
                (runner.ROOT / "supabase/config.toml").write_text("# fixture")
                bound = runner.source_inputs()
                actual = [name for name in bound if name.startswith("supabase/tests/database/")]
                self.assertEqual(len(actual), 70)
                changed = tests / "0_fixture.sql"
                before = bound[str(changed.relative_to(runner.ROOT))]
                changed.write_text("-- changed fixture")
                self.assertNotEqual(before, runner.source_inputs()[str(changed.relative_to(runner.ROOT))])
        finally:
            runner.ROOT = original_root
            runner.SQL_INPUTS = original_sql_inputs
            runner.__file__ = original_module_file

    def test_second_native_runner_cannot_take_the_same_local_generation(self):
        original_root = runner.ROOT
        with tempfile.TemporaryDirectory(prefix="guard-lock-", dir=path.parents[2]) as temporary:
            runner.ROOT = Path(temporary)
            (runner.ROOT / "test-results").mkdir()
            try:
                with runner.own_generation_lock():
                    with self.assertRaisesRegex(RuntimeError, "ANOTHER_OWNED_NATIVE_SQL_GENERATION_ACTIVE"):
                        with runner.own_generation_lock():
                            self.fail("Concurrent runtime ownership was granted")
                # Closing the first owner releases the actual lock.
                with runner.own_generation_lock():
                    pass
            finally:
                runner.ROOT = original_root


if __name__ == "__main__":
    unittest.main()
