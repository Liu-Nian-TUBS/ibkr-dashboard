from collections.abc import Callable

from apscheduler.schedulers.background import BackgroundScheduler


class DailySyncScheduler:
    def __init__(
        self,
        *,
        run_job: Callable[[], object],
        scheduler: BackgroundScheduler | None = None,
    ) -> None:
        self._run_job = run_job
        self._scheduler = scheduler or BackgroundScheduler()
        self._job_id = "daily_sync_job"
        self._started = False

    def start(self, *, interval_minutes: int) -> None:
        if interval_minutes <= 0:
            raise ValueError("interval_minutes must be greater than 0")
        if not self._started:
            self._scheduler.start()
            self._started = True
        self._scheduler.add_job(
            self._run_job,
            "interval",
            minutes=interval_minutes,
            id=self._job_id,
            replace_existing=True,
        )

    def update_interval(self, *, interval_minutes: int) -> None:
        self.start(interval_minutes=interval_minutes)

    def shutdown(self) -> None:
        if self._started:
            self._scheduler.shutdown(wait=False)
            self._started = False


class DailyTimeScheduler:
    def __init__(
        self,
        *,
        run_job: Callable[[], object],
        job_id: str,
        scheduler: BackgroundScheduler | None = None,
    ) -> None:
        self._run_job = run_job
        self._job_id = job_id
        self._scheduler = scheduler or BackgroundScheduler()
        self._started = False

    def schedule(self, *, time_of_day: str) -> None:
        hour_text, minute_text = time_of_day.split(":", maxsplit=1)
        if not self._started:
            self._scheduler.start()
            self._started = True
        self._scheduler.add_job(
            self._run_job,
            "cron",
            hour=int(hour_text),
            minute=int(minute_text),
            id=self._job_id,
            replace_existing=True,
        )

    def clear(self) -> None:
        if self._started and self._scheduler.get_job(self._job_id) is not None:
            self._scheduler.remove_job(self._job_id)

    def shutdown(self) -> None:
        if self._started:
            self._scheduler.shutdown(wait=False)
            self._started = False
