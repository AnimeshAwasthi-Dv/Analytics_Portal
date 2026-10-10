
CREATE TABLE IF NOT EXISTS studies (
    id BIGSERIAL PRIMARY KEY,
    modality VARCHAR(20),
    status VARCHAR(50) NOT NULL DEFAULT 'PROCESSING',
    instance_code VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS processing_jobs (
    id BIGSERIAL PRIMARY KEY,
    "internalJobId" BIGINT NOT NULL REFERENCES studies(id),
    "createdAt" TIMESTAMP,
    "completedAt" TIMESTAMP,
    "imageCount" INTEGER,
    "serviceType" VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS available_bridge_studies (
    id BIGSERIAL PRIMARY KEY,
    "processingJobId" BIGINT NOT NULL REFERENCES processing_jobs(id),
    "studyDescription" TEXT
);

CREATE INDEX IF NOT EXISTS idx_studies_status
    ON studies(status);

CREATE INDEX IF NOT EXISTS idx_studies_instance_code
    ON studies(instance_code);

CREATE INDEX IF NOT EXISTS idx_processing_jobs_internal_job_id
    ON processing_jobs("internalJobId");

CREATE INDEX IF NOT EXISTS idx_available_bridge_processing_job_id
    ON available_bridge_studies("processingJobId");
