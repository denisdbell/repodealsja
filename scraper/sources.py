"""
sources.py
==========

The master list of every place we grab repossessed cars and properties from.

Each source is a plain dictionary so it is very easy to read and edit.
If a bank changes its link, just update the URL here.

Fields:
    id          : short unique name (used for the saved file name)
    bank        : friendly bank / credit union name shown on the website
    category    : "property" or "vehicle"
    format      : "xlsx", "pdf" or "html"  (how we read the data)
    parent_url  : the page a human should click to visit the source
    file_url    : the direct link to the file or listing page to download / read
"""

SOURCES = [
    {
        "id": "ncb-property",
        "bank": "NCB (National Commercial Bank)",
        "category": "property",
        "format": "xlsx",
        "parent_url": "https://www.jncb.com/",
        "file_url": "https://www.jncb.com/getmedia/228e863f-fc8d-4ade-a645-f996d089ca14/Schedule_of_Properties_for_Sale_at_Private_Treaty_20260706.xlsx",
    },
    {
        "id": "ncb-vehicles",
        "bank": "NCB (National Commercial Bank)",
        "category": "vehicle",
        "format": "xlsx",
        "parent_url": "https://www.jncb.com/",
        "file_url": "https://www.jncb.com/getmedia/ff07ceba-7a59-4677-a347-5bce40a50b75/NCB_Repossessed_Motor_Vehicle_Listing_20260706.xlsx",
    },
    {
        "id": "scotia-listings",
        "bank": "Scotiabank",
        "category": "both",  # this page mixes cars and property
        "format": "html",
        "parent_url": "https://jm.scotiabank.com/personal/borrowing/mortgage-application-checklist/properties-auto-listing.html",
        "file_url": "https://jm.scotiabank.com/personal/borrowing/mortgage-application-checklist/properties-auto-listing.html",
    },
    {
        "id": "jmmb-property",
        "bank": "JMMB",
        "category": "property",
        "format": "pdf",
        "parent_url": "https://www.jmmb.com/",
        "file_url": "https://www.jmmb.com/sites/default/files/Jamaica/Attachments/Private-Treaty/Properties-Private-Treaty-May-2026.pdf",
    },
    {
        "id": "jmmb-vehicles",
        "bank": "JMMB",
        "category": "vehicle",
        "format": "pdf",
        "parent_url": "https://www.jmmb.com/",
        "file_url": "https://www.jmmb.com/sites/default/files/Jamaica/Attachments/Private-Treaty/Vehicles-for-Sale-May-2026.pdf",
    },
    {
        "id": "firstglobal-property",
        "bank": "First Global Bank",
        "category": "property",
        "format": "pdf",
        "parent_url": "https://firstglobal-bank.com/",
        "file_url": "https://firstglobal-bank.com/wp-content/uploads/2026/05/PROPERTIES-FOR-SALE.-May-2026.pdf",
    },
    {
        "id": "firstglobal-vehicles",
        "bank": "First Global Bank",
        "category": "vehicle",
        "format": "pdf",
        "parent_url": "https://firstglobal-bank.com/",
        "file_url": "https://firstglobal-bank.com/wp-content/uploads/2026/05/Advert-Reclaimed-listing-Motor-vehicle-May-2026.pdf",
    },
    {
        "id": "jn-vehicles",
        "bank": "JN Bank",
        "category": "vehicle",
        "format": "html",
        "parent_url": "https://vehicles.jnbank.com/",
        "file_url": "https://vehicles.jnbank.com/",
    },
    {
        "id": "cwj-property",
        "bank": "COK Sodality / CWJ Credit Union",
        "category": "property",
        "format": "html",
        "parent_url": "https://www.cwjcu.com/service/private-treaty-listing",
        "file_url": "https://www.cwjcu.com/service/private-treaty-listing",
    },
    {
        "id": "sagicor-vehicles",
        "bank": "Sagicor Bank",
        "category": "vehicle",
        "format": "pdf",
        "parent_url": "https://www.sagicor.com/",
        "file_url": "https://www.sagicor.com/-/media/sbj-repossessed-assets-2026/sagicor-bank-motor-vehicle-external-listing-as-at-april-9-2026.pdf?la=en-JM&hash=F34DC5914AFD5DB6DCFFD5DEB2E18E28058D082D",
    },
    {
        "id": "jpscu-vehicles",
        "bank": "JPS & Partners Co-operative Credit Union",
        "category": "vehicle",
        "format": "html",
        "parent_url": "https://jpscu.com/repossessed-vehicles/",
        "file_url": "https://jpscu.com/repossessed-vehicles/",
    },
    {
        "id": "infiniti-vehicles",
        "bank": "Infiniti Co-operative Credit Union",
        "category": "vehicle",
        "format": "html",
        "parent_url": "https://infiniticuja.com/repossessed-vehicles/",
        "file_url": "https://infiniticuja.com/repossessed-vehicles/",
    },
]
