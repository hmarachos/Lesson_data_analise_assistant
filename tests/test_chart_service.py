from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.core.config import Settings
from app.services.chart_service import ChartService
from app.services.file_service import FileService, StoredFile


class ChartServiceTests(unittest.TestCase):
    def test_bar_chart_falls_back_when_ai_suggests_missing_columns(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            upload_dir = root / "uploads"
            output_dir = root / "outputs"
            upload_dir.mkdir()
            output_dir.mkdir()

            csv_path = upload_dir / "people.csv"
            csv_path.write_text(
                "gender,age,score\n"
                "female,24,10\n"
                "male,31,12\n"
                "female,43,16\n",
                encoding="utf-8",
            )

            settings = Settings(
                app_name="Test",
                app_host="0.0.0.0",
                app_port=8001,
                max_file_size="10MB",
                max_file_size_bytes=10 * 1024 * 1024,
                upload_dir=upload_dir,
                output_dir=output_dir,
                storage_dir=root,
                templates_dir=root / "templates",
                static_dir=root / "static",
                log_level="INFO",
                openai_api_key=None,
                openai_model="gpt-5-mini",
                openai_max_history_messages=8,
            )
            stored_file = StoredFile(
                file_id="test-file",
                original_name="people.csv",
                saved_name="people.csv",
                extension=".csv",
                content_type="text/csv",
                size_bytes=csv_path.stat().st_size,
                kind="table",
                created_at="2026-05-05T00:00:00+00:00",
                absolute_path=str(csv_path),
                relative_path="uploads/people.csv",
            )

            chart = ChartService(FileService(settings), settings).generate_chart(
                stored_file,
                "bar",
                x_column="inferred_gender",
                y_column="count",
            )

            self.assertEqual(chart["title"], "Bar chart")
            self.assertTrue((output_dir / chart["file_name"]).exists())


if __name__ == "__main__":
    unittest.main()
