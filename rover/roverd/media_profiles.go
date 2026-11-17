package roverd

import (
	"bytes"
	"fmt"
	"gopkg.in/yaml.v3"
	"os"
	"path/filepath"
	"regexp"
)

var mediaCategories = []string{"video", "audioCapture", "audioPlayback"}
var profileID = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

type MediaProfile struct {
	ID          string `yaml:"id" json:"id"`
	Name        string `yaml:"name" json:"name"`
	Description string `yaml:"description" json:"description"`
	Setup       string `yaml:"setup" json:"setup"`
	Run         string `yaml:"run" json:"run"`
}

func validateProfile(p MediaProfile) error {
	if !profileID.MatchString(p.ID) || p.Name == "" || p.Run == "" {
		return fmt.Errorf("profile requires a lowercase identifier, name, and run command")
	}
	return nil
}

func LoadMediaProfiles(repo string) (map[string][]MediaProfile, error) {
	catalogs := make(map[string][]MediaProfile)
	for _, category := range mediaCategories {
		data, err := os.ReadFile(filepath.Join(repo, "rover", "profiles", category+".yaml"))
		if err != nil {
			return nil, err
		}
		decoder := yaml.NewDecoder(bytes.NewReader(data))
		decoder.KnownFields(true)
		var profiles []MediaProfile
		if err := decoder.Decode(&profiles); err != nil {
			return nil, fmt.Errorf("%s: %w", category, err)
		}
		seen := map[string]bool{}
		for _, p := range profiles {
			if err := validateProfile(p); err != nil {
				return nil, err
			}
			if p.ID == "custom" || seen[p.ID] {
				return nil, fmt.Errorf("duplicate/reserved profile %s", p.ID)
			}
			seen[p.ID] = true
		}
		data, err = os.ReadFile(filepath.Join("/etc/roverd/profiles", category+".yaml"))
		if err == nil {
			var custom MediaProfile
			decoder = yaml.NewDecoder(bytes.NewReader(data))
			decoder.KnownFields(true)
			if err = decoder.Decode(&custom); err != nil {
				return nil, err
			}
			if err = validateProfile(custom); err != nil {
				return nil, err
			}
			if custom.ID != "custom" {
				return nil, fmt.Errorf("custom profile ID must be custom")
			}
			profiles = append(profiles, custom)
		} else if !os.IsNotExist(err) {
			return nil, err
		}
		catalogs[category] = profiles
	}
	return catalogs, nil
}

func SaveCustomProfile(category string, profile MediaProfile) error {
	valid := false
	for _, name := range mediaCategories {
		if category == name {
			valid = true
		}
	}
	if !valid {
		return fmt.Errorf("unknown media category")
	}
	profile.ID = "custom"
	if err := validateProfile(profile); err != nil {
		return err
	}
	data, err := yaml.Marshal(profile)
	if err != nil {
		return err
	}
	dir := "/etc/roverd/profiles"
	if err = os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".profile-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err = file.Write(data); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(dir, category+".yaml"))
}
