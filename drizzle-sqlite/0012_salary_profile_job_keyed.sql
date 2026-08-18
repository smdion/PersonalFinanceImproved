-- Salary Profile pins move from personId-keyed to jobId-keyed. See
-- drizzle/0012_salary_profile_job_keyed.sql (Postgres) for the full
-- rationale — this is the SQLite mirror using json_group_object/json_each.

UPDATE `salary_profiles`
SET `salaries` = json((
	SELECT COALESCE(
		json_group_object(j.id, json(je.value)),
		'{}'
	)
	FROM json_each(`salary_profiles`.`salaries`) je
	JOIN `jobs` j
		ON j.person_id = CAST(je.key AS INTEGER)
		AND j.end_date IS NULL
));
