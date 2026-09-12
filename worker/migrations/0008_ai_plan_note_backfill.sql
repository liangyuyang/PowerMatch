UPDATE ai_models
SET config_json=json_set(
  config_json,
  '$.planFee',CAST(substr(trim(json_extract(config_json,'$.priceNote')),1,length(trim(json_extract(config_json,'$.priceNote')))-3) AS REAL),
  '$.planPeriod','month'
)
WHERE json_extract(config_json,'$.billingMode')='plan'
  AND COALESCE(json_type(config_json,'$.planFee'),'null')='null'
  AND CAST(substr(trim(json_extract(config_json,'$.priceNote')),1,length(trim(json_extract(config_json,'$.priceNote')))-3) AS REAL) BETWEEN 0 AND 10000
  AND trim(json_extract(config_json,'$.priceNote'))=printf('%g元/月',CAST(substr(trim(json_extract(config_json,'$.priceNote')),1,length(trim(json_extract(config_json,'$.priceNote')))-3) AS REAL));

UPDATE ai_models
SET config_json=json_set(
  config_json,
  '$.planFee',CAST(substr(trim(json_extract(config_json,'$.priceNote')),1,length(trim(json_extract(config_json,'$.priceNote')))-3) AS REAL),
  '$.planPeriod','year'
)
WHERE json_extract(config_json,'$.billingMode')='plan'
  AND COALESCE(json_type(config_json,'$.planFee'),'null')='null'
  AND CAST(substr(trim(json_extract(config_json,'$.priceNote')),1,length(trim(json_extract(config_json,'$.priceNote')))-3) AS REAL) BETWEEN 0 AND 10000
  AND trim(json_extract(config_json,'$.priceNote'))=printf('%g元/年',CAST(substr(trim(json_extract(config_json,'$.priceNote')),1,length(trim(json_extract(config_json,'$.priceNote')))-3) AS REAL));
