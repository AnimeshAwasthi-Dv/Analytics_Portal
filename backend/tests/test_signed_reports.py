import io
import unittest
from unittest.mock import Mock, patch
from fastapi import HTTPException
from app.pacs_documents import pdf

class SignedReportTests(unittest.TestCase):
 def setUp(self):
  self.source=Mock(code='marengo')
  self.source.report_rows.return_value=[{'editedReportJson':{'htmlReport':'placeholder','renewist':{'signedFiles':{'pdf':{'storage':{'bucket':'reports','key':'signed.pdf'}},'withoutLetterheadPdf':{'storage':{'bucket':'reports','key':'plain.pdf'}}}}}}]
 def test_serves_original_pdf_and_selected_variant(self):
  cfg={'S3_REPORTS_BUCKET':'reports','S3_ACCESS_KEY_ID':'test','S3_SECRET_ACCESS_KEY':'test'}
  client=Mock()
  client.get_object.side_effect=lambda **kwargs:{'Body':io.BytesIO(b'%PDF-original'),'ContentLength':13}
  with patch('app.pacs_viewer.config',return_value=cfg),patch('boto3.client',return_value=client):
   for variant,key in [('with-letterhead','signed.pdf'),('without-letterhead','plain.pdf')]:
    result=pdf(self.source,'report-id',variant)
    self.assertEqual(result.body,b'%PDF-original')
    client.get_object.assert_called_with(Bucket='reports',Key=key)
 def test_missing_signed_version_never_renders_placeholder(self):
  with self.assertRaises(HTTPException) as error:pdf(self.source,'report-id',format='docx')
  self.assertEqual(error.exception.status_code,404)
 def test_unconfigured_bucket_is_not_fetched(self):
  with patch('app.pacs_viewer.config',return_value={}),patch('boto3.client') as client:
   with self.assertRaises(HTTPException):pdf(self.source,'report-id')
   client.assert_not_called()
