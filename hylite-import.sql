-- Import Hylite plants and salesmen
BEGIN TRANSACTION;

-- Reset Hylite plants/salesmen
DELETE FROM plants WHERE tenant_id = '112f12b8-55e9-4de8-9fda-d58e37c75796';
DELETE FROM salesmen WHERE tenant_id = '112f12b8-55e9-4de8-9fda-d58e37c75796';

-- Plants (Hylite tenant)
INSERT OR REPLACE INTO plants (id, tenant_id, name, location, city, state, country, timezone, created_at, updated_at) VALUES
('1d9bc13a-b886-47a3-a95b-8f5f93521f45','112f12b8-55e9-4de8-9fda-d58e37c75796','Premier Electroplaters - Mumbai','Mumbai',NULL,NULL,NULL,'UTC','2025-11-23 07:38:34.115527+00','2025-11-23 07:38:34.115527+00'),
('2e177bea-cc42-463a-a9ed-dcf1b6ebd50b','112f12b8-55e9-4de8-9fda-d58e37c75796','Poona PVD LLP - Bhosari','Bhosari',NULL,NULL,NULL,'UTC','2025-11-23 07:37:48.550981+00','2025-11-23 07:37:48.550981+00'),
('3b6bac99-a85e-45c8-b2ed-dbc5203c2fb1','112f12b8-55e9-4de8-9fda-d58e37c75796','Sparkle Eco Finishes - Chakan','Chakan',NULL,NULL,NULL,'UTC','2025-11-23 07:35:26.86315+00','2025-11-23 07:39:32.167+00'),
('423fb7c8-51d0-47f5-8bc5-2fdc0e4f8695','112f12b8-55e9-4de8-9fda-d58e37c75796','Hylite Galvanisers Pvt Ltd - Chakan','Chakan',NULL,NULL,NULL,'UTC','2025-11-23 07:33:38.039093+00','2025-11-23 07:39:22.263+00'),
('5d3b1922-ea5d-48f0-a15a-896cc1a97670','112f12b8-55e9-4de8-9fda-d58e37c75796','Fakhri Galvanisers Pvt Ltd - Taloja','Taloja',NULL,NULL,NULL,'UTC','2025-11-23 07:36:47.396014+00','2025-11-23 07:38:52.662+00'),
('9a95512f-9c72-4de1-864e-0219c44b8ea3','112f12b8-55e9-4de8-9fda-d58e37c75796','Hylite Electroplaters Pvt Ltd - Navi Mumbai','Navi Mumbai',NULL,NULL,NULL,'UTC','2025-11-23 07:34:39.15853+00','2025-11-23 07:39:06.495+00'),
('f2e18b86-6960-45b9-9a2a-dae18350de4c','112f12b8-55e9-4de8-9fda-d58e37c75796','Hylite Galvanisers - Pimpri','Pimpri',NULL,NULL,NULL,'UTC','2025-11-23 07:33:01.796051+00','2025-11-23 07:39:14.934+00');

-- Salesmen (Hylite tenant)
INSERT OR REPLACE INTO salesmen (id, tenant_id, user_id, name, phone, email, plant_id, is_active, current_latitude, current_longitude, last_location_update, assigned_customers, created_at, updated_at) VALUES
('1aaec88c-025d-4027-b3f7-63bcae500d6d','112f12b8-55e9-4de8-9fda-d58e37c75796',NULL,'abbas sales','8530499971','',NULL,1,NULL,NULL,NULL,NULL,'2025-11-26 07:12:45.920867+00','2025-11-26 07:12:45.920867+00'),
('5b91a0e2-4a5e-47f1-aab6-f71f0b187c3e','112f12b8-55e9-4de8-9fda-d58e37c75796',NULL,'Sarrah Sanchawala','8888450842','', '2e177bea-cc42-463a-a9ed-dcf1b6ebd50b',1,NULL,NULL,NULL,NULL,'2025-11-24 13:07:03.638269+00','2025-11-24 13:07:11.758465+00'),
('69c332ba-36b7-4e32-b0ce-beab3d787736','112f12b8-55e9-4de8-9fda-d58e37c75796',NULL,'Murtaza Bootwala','9359338856','', 'f2e18b86-6960-45b9-9a2a-dae18350de4c',1,NULL,NULL,NULL,NULL,'2025-11-25 08:40:52.534639+00','2025-11-25 09:19:33.252771+00'),
('7df22b98-b397-472f-a33a-0365cf9545dc','112f12b8-55e9-4de8-9fda-d58e37c75796',NULL,'Abbas Rangoonwala','9730965552','', '5d3b1922-ea5d-48f0-a15a-896cc1a97670',1,NULL,NULL,NULL,NULL,'2025-11-23 04:47:19.171923+00','2025-11-24 13:03:43.953444+00'),
('7fd72650-7287-43a0-aa1c-d547e1204340','112f12b8-55e9-4de8-9fda-d58e37c75796',NULL,'ADMIN','1234567890','', '423fb7c8-51d0-47f5-8bc5-2fdc0e4f8695',1,NULL,NULL,NULL,NULL,'2025-11-25 14:12:27.813264+00','2025-11-26 07:12:05.594277+00'),
('9bc9c4bf-9b6b-4757-adf7-4c34558af4e9','112f12b8-55e9-4de8-9fda-d58e37c75796',NULL,'Hamza Bootwala','9819370256','', '9a95512f-9c72-4de1-864e-0219c44b8ea3',1,NULL,NULL,NULL,NULL,'2025-11-24 13:08:49.486023+00','2025-11-26 07:01:27.526144+00'),
('9c6ba0fa-a516-4c5b-bbe0-04a01b5f0125','112f12b8-55e9-4de8-9fda-d58e37c75796',NULL,'Mudar Sanchawala','9766748786','', '423fb7c8-51d0-47f5-8bc5-2fdc0e4f8695',1,NULL,NULL,NULL,NULL,'2025-11-24 13:00:46.59389+00','2025-11-26 10:56:35.900407+00'),
('9d253c85-7f22-4bc7-9abd-bca34ed88877','112f12b8-55e9-4de8-9fda-d58e37c75796',NULL,'Burhanuddin Rangwala','9890777102','', '2e177bea-cc42-463a-a9ed-dcf1b6ebd50b',1,NULL,NULL,NULL,NULL,'2025-11-24 13:05:28.568669+00','2025-11-24 13:16:16.129665+00'),
('b4cc8d15-2099-43e2-b1f8-435e31b69658','112f12b8-55e9-4de8-9fda-d58e37c75796',NULL,'Alok','8600259300','', '5d3b1922-ea5d-48f0-a15a-896cc1a97670',1,NULL,NULL,NULL,NULL,'2025-11-23 05:40:33.313725+00','2025-11-23 07:40:41.61876+00'),
('d22bf296-af49-4812-bee6-9c7a3df8d116','112f12b8-55e9-4de8-9fda-d58e37c75796',NULL,'Kiran Kamble','9137783276','', '9a95512f-9c72-4de1-864e-0219c44b8ea3',1,NULL,NULL,NULL,NULL,'2025-11-24 13:15:07.859734+00','2025-11-25 08:41:40.530933+00'),
('e2e80a08-9bca-4550-a682-bfeac7f55d86','112f12b8-55e9-4de8-9fda-d58e37c75796',NULL,'Yusuf  Bootwala','9769395452','', '5d3b1922-ea5d-48f0-a15a-896cc1a97670',1,NULL,NULL,NULL,NULL,'2025-11-24 13:03:16.586685+00','2025-11-26 10:58:03.505037+00'),
('fb1fd619-73d1-46ad-b03d-37c3e2eb78cc','112f12b8-55e9-4de8-9fda-d58e37c75796',NULL,'Fatema Bawaji','9766194752','', '2e177bea-cc42-463a-a9ed-dcf1b6ebd50b',1,NULL,NULL,NULL,NULL,'2025-11-24 13:04:56.29289+00','2025-11-26 07:10:50.072387+00');

COMMIT;
