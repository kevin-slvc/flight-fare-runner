import contextlib
import datetime as dt
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import collect


class RequestTests(unittest.TestCase):
    def request(self, destinations=('ICN',)):
        now=dt.datetime.now(dt.timezone.utc)
        today=now.astimezone(collect.ZoneInfo('Asia/Tokyo')).date()
        return {'requestId':'00000000-0000-4000-8000-000000000001','createdAt':now.isoformat(),
                'tasks':[{'from':'NRT','to':city,'out':str(today+dt.timedelta(days=30)),
                          'back':str(today+dt.timedelta(days=40))} for city in destinations]}

    def run_capture(self, root, request, child):
        (root/'requests').mkdir()
        (root/'requests/latest.json').write_text(json.dumps(request))
        with patch.object(collect,'ROOT',root),patch.object(collect,'bounded',side_effect=child) as process, \
             patch.object(collect.time,'sleep'),contextlib.redirect_stdout(io.StringIO()):
            code=collect.main()
        return code,json.loads((root/'private-output/receipt.json').read_text()),process

    def test_accepts_the_five_existing_cities(self):
        request=self.request(('ICN','TPE','HKG','SGN','BKK'))
        self.assertEqual(collect.validate(request),request)

    def test_rejects_duplicate_same_city_airports(self):
        with self.assertRaises(ValueError):collect.validate(self.request(('TPE','TSA')))

    def test_cannot_add_arbitrary_url_or_shell_argument(self):
        for field,value in [('url','https://example.com'),('from','NRT;touch bad')]:
            request=self.request();request['tasks'][0][field]=value
            with self.assertRaises(ValueError):collect.validate(request)

    def test_queued_stale_request_gets_a_negative_receipt_without_browser(self):
        with tempfile.TemporaryDirectory() as temp:
            request=self.request();request['createdAt']=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(minutes=46)).isoformat()
            code,receipt,process=self.run_capture(Path(temp),request,lambda *args:0)
            self.assertEqual(code,2);self.assertEqual(receipt['status'],'request_rejected')
            self.assertEqual(receipt['observations'],[]);process.assert_not_called()

    def test_exit_zero_without_original_is_not_capture_success(self):
        with tempfile.TemporaryDirectory() as temp:
            code,receipt,_=self.run_capture(Path(temp),self.request(),lambda *args:0)
            self.assertEqual(code,2);self.assertEqual(receipt['status'],'capture_failed')
            self.assertFalse(receipt['publicationAttempted'])

    def test_human_verification_stops_the_remaining_cities(self):
        with tempfile.TemporaryDirectory() as temp:
            def blocked(args,seconds):
                Path(args[-1]).write_text(json.dumps({'stage':'failed','reason':'human_verification_required'}))
                return 0
            code,receipt,process=self.run_capture(Path(temp),self.request(('ICN','TPE','HKG','SGN','BKK')),blocked)
            self.assertEqual(code,2);self.assertTrue(receipt['providerPaused'])
            self.assertEqual(len(receipt['observations']),1);self.assertEqual(process.call_count,1)

    def test_provider_access_restriction_stops_without_retry(self):
        with tempfile.TemporaryDirectory() as temp:
            def blocked(args,seconds):
                Path(args[-1]).write_text(json.dumps({'stage':'failed','diagnosticText':'whaleguard block\n'}))
                return 0
            code,receipt,process=self.run_capture(Path(temp),self.request(('ICN','TPE','HKG')),blocked)
            self.assertEqual(code,2);self.assertTrue(receipt['providerPaused']);self.assertEqual(process.call_count,1)

    def test_interrupt_never_leaves_a_success_status(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'requests').mkdir();(root/'requests/latest.json').write_text(json.dumps(self.request()))
            with patch.object(collect,'ROOT',root),patch.object(collect,'bounded',side_effect=KeyboardInterrupt), \
                 contextlib.redirect_stdout(io.StringIO()),self.assertRaises(KeyboardInterrupt):
                collect.main()
            receipt=json.loads((root/'private-output/receipt.json').read_text())
            self.assertEqual(receipt['status'],'runner_failed')

    def test_unpaired_surrogate_is_preserved_in_a_readable_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            def child(args,seconds):
                Path(args[-1]).write_text(json.dumps({'stage':'failed','reason':'fixture','diagnosticText':'\ud800'}))
                return 0
            _,receipt,_=self.run_capture(Path(temp),self.request(),child)
            self.assertEqual(receipt['observations'][0]['raw']['diagnosticText'],'\ud800')


if __name__=='__main__':unittest.main()
