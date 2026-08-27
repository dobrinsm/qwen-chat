#!/usr/bin/env python3
"""Inspect + update executionTimeoutMs on the live qwen27b serverless endpoint."""
import os, sys
os.chdir("/root/.hermes/scripts/qwen27b")
from dotenv import load_dotenv
load_dotenv("/root/.hermes/.env")
import runpod
runpod.api_key = os.getenv("RUNPOD_API_KEY")
from runpod.api import graphql

def gql(q):
    return graphql.run_graphql_query(q)

EP = "c35fhlr8aefckk"

if len(sys.argv) > 1 and sys.argv[1] == "set":
    ms = int(sys.argv[2])
    q = f'''mutation {{
      saveEndpoint(input: {{
        id: "{EP}", name: "qwen27b-nvfp4-20260827121902", workersMax: 1, executionTimeoutMs: 600000
      }}) {{ id executionTimeoutMs }}
    }}'''
    r = gql(q)
    print(r)
else:
    q = '''query {
      myself {
        endpoints {
          id name executionTimeoutMs workersMax
        }
      }
    }'''
    r = gql(q)
    eps = r["data"]["myself"]["endpoints"] or []
    hits = [e for e in eps if e["id"] == EP]
    print(hits if hits else f"endpoint {EP} not found among {len(eps)}")
