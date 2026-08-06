import requests
from lxml import html
import json

def get_all_links(base_url, path):
    response = requests.get(base_url + path)
    tree = html.fromstring(response.content)

    links = []
    for a_tag in tree.xpath("//table/tbody/tr/td[1]/a"):
        href = a_tag.get("href")
        if href:
            links.append(href if href.startswith("http") else base_url + href)
    return links

def scrape_details(url):
    response = requests.get(url)
    tree = html.fromstring(response.content)

    rule_id = tree.xpath("//*[@class='ruleIdData']/text()")
    disability_types_el = tree.xpath("//*[@class='disabilityTypesAffectedData']/ul/li")

    return {
        "ruleId": rule_id[0].strip() if rule_id else "",
            "disabilityTypesAffected": [{"name": t.xpath("./text()")[0].strip() if t.xpath("./text()") else "", "style": t.xpath("./i/@class")[0] if t.xpath("./i/@class") else ""} for t in disability_types_el],
         }

def main():
    version = ["4.13", "4.12", "4.11", "4.10", "4.9", "4.8", "4.7", "4.6", "4.5", "4.4", "4.3", "4.2", "4.1", "4.0", "3.5", "3.4", "3.3", "3.2", "3.1", "3.0", "2.6", "2.5", "2.4", "2.3", "2.2", "2.1", "2.0", "1.1"]
    base_url = "https://dequeuniversity.com"  # Change this to the target website
    for v in version:
        links = get_all_links(base_url, "/rules/axe/html/" + v)
        results = []
        for link in links:
            details = scrape_details(link)
            if details["ruleId"]:
                results.append(details)

        with open(f'{v}.json', 'w') as f:
            f.write(json.dumps(results))

if __name__ == "__main__":
    main()
