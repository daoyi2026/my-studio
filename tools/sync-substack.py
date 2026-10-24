"""Refresh the public writing snapshot; failed refreshes leave the old file intact."""
import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

FEED_URL = 'https://daoooyi.substack.com/feed'
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / 'public/content/substack-posts.json'


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.ignored = 0

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style'}:
            self.ignored += 1

    def handle_endtag(self, tag):
        if tag in {'script', 'style'} and self.ignored:
            self.ignored -= 1
        elif tag in {'p', 'div', 'br'} and not self.ignored:
            self.parts.append(' ')

    def handle_data(self, data):
        if not self.ignored:
            self.parts.append(data)


def plain_text(value, limit):
    parser = PlainText()
    parser.feed(unescape(value or ''))
    return ' '.join(''.join(parser.parts).split())[:limit]


def public_post_url(value):
    try:
        url = urlsplit((value or '').strip())
        if url.scheme != 'https' or url.hostname != 'daoooyi.substack.com' or url.port not in (None, 443) or url.username or url.password or not url.path.startswith('/p/'):
            return None
        return url.geturl()
    except ValueError:
        return None


def parse_feed(raw, now=None):
    if b'<!DOCTYPE' in raw.upper():
        raise ValueError('RSS document types are not supported')
    root = ET.fromstring(raw)
    channel = root.find('channel')
    if root.tag != 'rss' or channel is None or urlsplit(channel.findtext('link', '')).hostname != 'daoooyi.substack.com':
        raise ValueError('Unexpected public RSS channel')
    posts, seen = [], set()
    items = channel.findall('item')
    for item in items:
        title = plain_text(item.findtext('title'), 280)
        url = public_post_url(item.findtext('link'))
        if not title or not url or url in seen:
            continue
        seen.add(url)
        published = None
        try:
            date = parsedate_to_datetime(item.findtext('pubDate', ''))
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            published = date.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
        except (TypeError, ValueError, OverflowError):
            pass
        description = item.findtext('description') or item.findtext('{http://purl.org/rss/1.0/modules/content/}encoded') or ''
        posts.append({'title': title, 'url': url, 'publishedAt': published, 'summary': plain_text(description, 160)})
    if items and not posts:
        raise ValueError('RSS items contain no valid public posts')
    posts.sort(key=lambda post: post['publishedAt'] or '', reverse=True)
    return {'version': 1, 'source': FEED_URL, 'updatedAt': (now or datetime.now(timezone.utc)).isoformat().replace('+00:00', 'Z'), 'posts': posts[:5]}


def download_feed():
    request = Request(FEED_URL, headers={'User-Agent': 'MyRoom-public-writing-sync/1.0', 'Accept': 'application/rss+xml, application/xml'})
    with urlopen(request, timeout=20) as response:
        raw = response.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError('RSS exceeds the bounded snapshot input size')
    return raw


def sync(output=DEFAULT_OUTPUT, fetcher=download_feed):
    snapshot = parse_feed(fetcher())
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=output.parent, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(snapshot, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.replace(temporary, output)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    return snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        snapshot = sync(args.output)
    except Exception as error:
        print(f'Substack refresh failed; previous snapshot retained: {error}', file=sys.stderr)
        return 1
    print(f'Writing snapshot refreshed: {len(snapshot["posts"])} public posts -> {args.output}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
