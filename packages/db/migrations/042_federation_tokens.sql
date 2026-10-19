ALTER TABLE federation_instances ADD COLUMN outbound_token TEXT;
ALTER TABLE federation_instances ADD COLUMN inbound_token_hash TEXT;
ALTER TABLE federation_instances ADD COLUMN inbound_token_prefix TEXT;
