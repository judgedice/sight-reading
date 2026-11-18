# Corpus pipeline entry points. Run from anywhere: make -C tools/corpus-build <target>.
# The clone cache is outside the repo: $(SIGHT_READING_CORPUS_CACHE) or ~/.cache/sight-reading-corpus.
PYTHON ?= python3

.PHONY: install fetch lock verify composers gate all test clean

install:
	$(PYTHON) -m pip install -r requirements.txt

# Clone (blobless, sparse) at the pinned SHAs, check the lock, run the licence and PD gate.
all:
	$(PYTHON) -m corpus_build

fetch:
	$(PYTHON) -m corpus_build fetch

# Rewrites sources.lock.yaml. Only needed after changing a pinned SHA in sources.yaml.
lock:
	$(PYTHON) -m corpus_build lock

verify:
	$(PYTHON) -m corpus_build verify

composers:
	$(PYTHON) -m corpus_build composers

gate:
	$(PYTHON) -m corpus_build verify gate

test:
	$(PYTHON) -m pytest

clean:
	rm -rf build .pytest_cache
