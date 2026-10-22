WITH ut(product_id, produkt) AS (VALUES
  ('6437', 'Angelic Captain'),
  ('6443', 'Brutal Expulsion'),
  ('6436', 'Ally Encampment'),
  ('6438', 'Barrage Tyrant'),
  ('6440', 'Blight Herder'),
  ('6442', 'Brood Butcher'),
  ('6435', 'Aligned Hedron Network'),
  ('66229', 'Unflinching Hieromancer'),
  ('66629', 'Unflinching Hieromancer (foil)'),
  ('14181', 'Adorned Puoncer'),
  ('13419', 'Ninth Bridge Control'),
  ('12801', 'Depala, Pioneer Exemplar'),
  ('13483', 'Whirler Virtouso'),
  ('18825', 'Spilcer''s Skill'),
  ('39555', 'Malcator''s Watch (foil)'),
  ('16991', 'Homunculus'),
  ('5830', 'Stonewing Antagonizer')
)
INSERT INTO mystore_links (product_id, card_id, finish, ignored, kilde, updated_at)
SELECT u.product_id, NULL, 'nonfoil', 1, 'manuell', datetime('now') FROM ut u WHERE true
ON CONFLICT(product_id) DO UPDATE SET
  card_id = NULL, ignored = 1, kilde = 'manuell', updated_at = excluded.updated_at;
